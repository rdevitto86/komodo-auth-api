import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { fileURLToPath } from 'node:url';
import { ENV_DEV, ENV_STAGING, ENV_PROD } from 'komodo-forge-sdk-ts/cdk/constants';
import type { EnvConfig } from 'komodo-forge-sdk-ts/cdk/config';
import {
  defaultDevConfig,
  defaultStgConfig,
  defaultProdConfig,
  defaultTags,
} from 'komodo-forge-sdk-ts/cdk/config';
import { createLogGroup, createAlarm } from 'komodo-forge-sdk-ts/cdk/observability';
import {
  FargatePublicService,
  FargatePrivateService,
  WafWebAcl,
  MetricFilterAlarm,
} from 'komodo-forge-sdk-ts/cdk/constructs';

export const API_NAME = 'komodo-auth-api';
export const CONTAINER_NAME = 'auth-api';
export const PUBLIC_PORT = 7011;
export const PRIVATE_PORT = 7012;
export const PUBLIC_VERSION = 'latest';
export const PRIVATE_VERSION = 'latest';
export const EVAL_RULES_PATH = '/app/config/validation_rules.yaml';

export interface AuthEnvConfig extends EnvConfig {
  bannedCustomersTable?: string;
  elasticacheSgId?: string;
}

export const DEV_CONFIG: AuthEnvConfig = {
  ...defaultDevConfig(),
  name: API_NAME,
  maxCapacity: 1,
  certificateArn: 'PLACEHOLDER-acm-cert-arn-us-east-2',
  secretPath: `komodo/${ENV_DEV}/${CONTAINER_NAME}`,
  downstreamUrls: [
    'http://user-api-public.komodo-dev.local:7052',
    'http://communications-api.komodo-dev.local:7081',
  ],
  vpcTag: `komodo-${ENV_DEV}`,
  domainName: `auth-${ENV_DEV}.komodo.com`,
  tags: {
    ...defaultTags(),
    project: API_NAME,
    environment: ENV_DEV,
    dataClassification: 'sensitive',
  },
};

export const STG_CONFIG: AuthEnvConfig = {
  ...defaultStgConfig(),
  name: API_NAME,
  certificateArn: 'PLACEHOLDER-acm-cert-arn-us-east-2',
  cloudFrontCertificateArn: 'PLACEHOLDER-acm-cert-arn-us-east-1',
  secretPath: `komodo/${ENV_STAGING}/${CONTAINER_NAME}`,
  downstreamUrls: [
    'http://user-api-public.komodo-stg.local:7052',
    'http://communications-api.komodo-stg.local:7081',
  ],
  vpcTag: `komodo-${ENV_STAGING}`,
  domainName: `auth-${ENV_STAGING}.komodo.com`,
  bannedCustomersTable: 'komodo-banned-customers-stg',
  elasticacheSgId: 'PLACEHOLDER-sg-elasticache-stg',
  tags: {
    ...defaultTags(),
    project: API_NAME,
    environment: ENV_STAGING,
    dataClassification: 'sensitive',
  },
};

export const PROD_CONFIG: AuthEnvConfig = {
  ...defaultProdConfig(),
  name: API_NAME,
  certificateArn: 'PLACEHOLDER-acm-cert-arn-us-east-2',
  cloudFrontCertificateArn: 'PLACEHOLDER-acm-cert-arn-us-east-1',
  secretPath: `komodo/${ENV_PROD}/${CONTAINER_NAME}`,
  downstreamUrls: [
    'http://user-api-public.komodo-prod.local:7052',
    'http://communications-api.komodo-prod.local:7081',
  ],
  vpcTag: `komodo-${ENV_PROD}`,
  domainName: 'auth.komodo.com',
  bannedCustomersTable: 'komodo-banned-customers-prod',
  elasticacheSgId: 'PLACEHOLDER-sg-elasticache-prod',
  tags: {
    ...defaultTags(),
    project: API_NAME,
    environment: ENV_PROD,
    dataClassification: 'sensitive',
  },
};

export interface ServiceBuildContext {
  vpc: ec2.IVpc;
  cluster: ecs.ICluster;
  logGroup: logs.ILogGroup;
  cfg: AuthEnvConfig;
}

export const buildPublicContainer = (stack: cdk.Stack, { vpc, cluster, logGroup, cfg }: ServiceBuildContext): FargatePublicService =>
  new FargatePublicService(stack, 'Public', {
    vpc,
    cluster,
    logGroup,
    serviceName: `${API_NAME}-public-${cfg.env}`,
    image: ecs.ContainerImage.fromEcrRepository(
      ecr.Repository.fromRepositoryName(stack, 'PublicRepo', `${API_NAME}-public`),
      PUBLIC_VERSION,
    ),
    containerPort: PUBLIC_PORT,
    cpu: cfg.cpu,
    memoryLimitMiB: cfg.memory,
    desiredCount: cfg.minCapacity,
    minCapacity: cfg.minCapacity,
    maxCapacity: cfg.maxCapacity,
    certificateArn: cfg.certificateArn,
    secretPath: cfg.secretPath,
    streamPrefix: 'public',
    healthCheckCommand: ['CMD', '/komodo', '-healthcheck'],
    environment: {
      APP_NAME: API_NAME,
      PORT: `:${PUBLIC_PORT}`,
      VERSION: PUBLIC_VERSION,
      EVAL_RULES_PATH: EVAL_RULES_PATH,
      AWS_REGION: cfg.regions[0].region,
      BANNED_CUSTOMERS_TABLE: cfg.bannedCustomersTable ?? '',
      USER_API_PRIVATE_URL: cfg.downstreamUrls?.[0] ?? '',
      COMMUNICATIONS_API_URL: cfg.downstreamUrls?.[1] ?? '',
      AWS_SECRET_PATH: cfg.secretPath ?? '',
    },
  });

export const buildPrivateContainer = (stack: cdk.Stack, { vpc, cluster, logGroup, cfg }: ServiceBuildContext): FargatePrivateService =>
  new FargatePrivateService(stack, 'Private', {
    vpc,
    cluster,
    logGroup,
    serviceName: `${API_NAME}-private-${cfg.env}`,
    image: ecs.ContainerImage.fromEcrRepository(
      ecr.Repository.fromRepositoryName(stack, 'PrivateRepo', `${API_NAME}-private`),
      PRIVATE_VERSION,
    ),
    containerPort: PRIVATE_PORT,
    cpu: cfg.cpu,
    memoryLimitMiB: cfg.memory,
    desiredCount: cfg.minCapacity,
    minCapacity: cfg.minCapacity,
    maxCapacity: cfg.maxCapacity,
    secretPath: cfg.secretPath,
    streamPrefix: 'private',
    healthCheckCommand: ['CMD', '/komodo', '-healthcheck'],
    environment: {
      APP_NAME: `${API_NAME}-internal`,
      PORT_PRIVATE: `:${PRIVATE_PORT}`,
      VERSION: PRIVATE_VERSION,
      AWS_REGION: cfg.regions[0].region,
      AWS_SECRET_PATH: cfg.secretPath ?? '',
    },
  });

export const buildWaf = (stack: cdk.Stack, alb: elbv2.ApplicationLoadBalancer): WafWebAcl => new WafWebAcl(stack, 'Waf', {
  metricPrefix: 'KomodoAuthWaf',
  associateAlb: alb,
  managedRuleGroups: [
    { name: 'AWSManagedRulesCommonRuleSet' },
    { name: 'AWSManagedRulesKnownBadInputsRuleSet' },
  ],
  globalRateLimit: 2000,
  rateLimitRules: [
    {
      name: 'OtpRateLimit',
      limit: 100,
      pathPrefix: '/v1/otp/',
    },
    {
      name: 'PasskeyRateLimit',
      limit: 100,
      pathPrefix: '/v1/passkeys/',
    },
  ],
});

export const buildAuthAlarms = (stack: cdk.Stack, logGroup: logs.ILogGroup, alb: elbv2.ApplicationLoadBalancer) => {
  new MetricFilterAlarm(stack, 'Issuance5xx', {
    logGroup,
    filterPattern: '{ $.status >= 500 && ($.path = "/v1/oauth/token" || $.path = "/v1/otp/verify") }',
    metricNamespace: 'KomodoAuth',
    metricName: 'Issuance5xxCount',
    alarmName: 'Issuance5xxAlarm',
    threshold: 10,
  });

  new MetricFilterAlarm(stack, 'OtpAbuse', {
    logGroup,
    filterPattern: '{ $.status = 429 && $.path = "/v1/otp/*" }',
    metricNamespace: 'KomodoAuth',
    metricName: 'OtpAbuse429Count',
    alarmName: 'OtpAbuseAlarm',
    threshold: 50,
  });

  new MetricFilterAlarm(stack, 'OtpBruteForce', {
    logGroup,
    filterPattern: '{ $.status = 401 && $.path = "/v1/otp/verify" }',
    metricNamespace: 'KomodoAuth',
    metricName: 'OtpBruteForce401Count',
    alarmName: 'OtpBruteForceAlarm',
    threshold: 100,
  });

  new MetricFilterAlarm(stack, 'RedisUnreachable', {
    logGroup,
    filterPattern: '{ $.msg = "readiness check failed" && $.error = "*failed to reach redis*" }',
    metricNamespace: 'KomodoAuth',
    metricName: 'RedisUnreachableCount',
    alarmName: 'RedisUnreachableAlarm',
    threshold: 3,
  });

  new MetricFilterAlarm(stack, 'JwksUnavailable', {
    logGroup,
    filterPattern: '{ $.status >= 500 && $.path = "/.well-known/jwks.json" }',
    metricNamespace: 'KomodoAuth',
    metricName: 'JwksUnavailableCount',
    alarmName: 'JwksUnavailableAlarm',
    threshold: 5,
  });

  createAlarm(stack, new cloudwatch.Metric({
    metricName: 'TargetResponseTime',
    namespace: 'AWS/ApplicationELB',
    dimensionsMap: { LoadBalancer: alb.loadBalancerArn },
    statistic: 'p99',
    period: cdk.Duration.seconds(60),
  }))
    .setAlarmName('LatencyP99Alarm')
    .setThreshold(0.5)
    .setEvaluationPeriods(2)
    .setComparisonOperator(cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD)
    .setTreatMissingData(cloudwatch.TreatMissingData.NOT_BREACHING)
    .build();
};

export const buildBannedCustomerDynamoDB = (stack: cdk.Stack, tableName: string, ...taskRoles: iam.IRole[]) => {
  const table = dynamodb.Table.fromTableName(stack, 'BannedCustomersTable', tableName);
  for (const role of taskRoles) {
    table.grantReadData(role);
  }
};

export const buildAuthCache = (stack: cdk.Stack, taskSgs: ec2.ISecurityGroup[], elasticacheSgId: string) => {
  for (let i = 0; i < taskSgs.length; i++) {
    new ec2.CfnSecurityGroupIngress(stack, `CacheIngress${i}`, {
      groupId: elasticacheSgId,
      sourceSecurityGroupId: taskSgs[i].securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 6379,
      toPort: 6379,
    });
  }
};

export const buildStack = (stack: cdk.Stack, cfg: AuthEnvConfig): void => {
  const logGroup = createLogGroup(stack)
    .setLogGroupName(`/ecs/${API_NAME}-${cfg.env}`)
    .setRetention(logs.RetentionDays.ONE_MONTH)
    .setRemovalPolicy(cdk.RemovalPolicy.DESTROY)
    .build();

  const vpc = ec2.Vpc.fromLookup(stack, 'Vpc', { tags: { Name: cfg.vpcTag } });
  const cluster = new ecs.Cluster(stack, 'Cluster', { vpc, clusterName: `${API_NAME}-${cfg.env}` });
  const ctx: ServiceBuildContext = { vpc, cluster, logGroup, cfg };
  const publicSvc = buildPublicContainer(stack, ctx);
  const privateSvc = buildPrivateContainer(stack, ctx);

  if (cfg.tags) {
    for (const [key, value] of Object.entries(cfg.tags)) {
      cdk.Tags.of(stack).add(key, value);
    }
  }

  new cdk.CfnOutput(stack, 'AlbDnsName', { value: publicSvc.alb.loadBalancerDnsName });
  new cdk.CfnOutput(stack, 'ClusterName', { value: cluster.clusterName });
  new cdk.CfnOutput(stack, 'PublicServiceName', { value: publicSvc.service.serviceName });
  new cdk.CfnOutput(stack, 'PrivateServiceName', { value: privateSvc.service.serviceName });
  new cdk.CfnOutput(stack, 'DomainName', { value: cfg.domainName });

  if (cfg.env === 'dev') return;

  if (!cfg.bannedCustomersTable || !cfg.elasticacheSgId) {
    throw new Error(`missing bannedCustomersTable or elasticacheSgId for ${cfg.env}`);
  }

  const waf = buildWaf(stack, publicSvc.alb);
  buildAuthAlarms(stack, logGroup, publicSvc.alb);
  buildBannedCustomerDynamoDB(stack, cfg.bannedCustomersTable, publicSvc.taskDefinition.taskRole, privateSvc.taskDefinition.taskRole);
  buildAuthCache(stack, [publicSvc.taskSecurityGroup, privateSvc.taskSecurityGroup], cfg.elasticacheSgId);

  new cdk.CfnOutput(stack, 'WafWebAclArn', { value: waf.webAcl.attrArn });
  new cdk.CfnOutput(stack, 'BannedCustomersTableName', { value: cfg.bannedCustomersTable });
  new cdk.CfnOutput(stack, 'ElastiCacheSgId', { value: cfg.elasticacheSgId });
};

export const createInfra = () => {
  try {
    const app = new cdk.App();
    const env = app.node.tryGetContext('env');
    if (!env) throw new Error('missing env variable');
    const cfg = env === 'dev' ? DEV_CONFIG : env === 'stg' ? STG_CONFIG : PROD_CONFIG;
    if (!cfg) throw new Error(`unknown environment ${env}, expected dev|stg|prod`);

    const account = cfg.account || app.node.tryGetContext('account') || '';

    for (const rd of cfg.regions) {
      if (!rd.enabled) continue;
      const suffix = rd.suffix ? `-${rd.suffix}` : '';
      const stack = new cdk.Stack(app, `KomodoAuth-${cfg.env}${suffix}`, { env: { account, region: rd.region } });
      buildStack(stack, cfg);
    }
  } catch (err) {
    console.error('failed to create infrastructure:', err);
    process.exit(1);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createInfra();
}
