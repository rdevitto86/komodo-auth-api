import { describe, it, expect, vi } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Template, Match } from 'aws-cdk-lib/assertions';
import type { AuthEnvConfig, ServiceBuildContext } from './main.js';
import {
  DEV_CONFIG,
  STG_CONFIG,
  PROD_CONFIG,
  API_NAME,
  PUBLIC_PORT,
  PRIVATE_PORT,
  buildStack,
  buildPublicContainer,
  buildPrivateContainer,
  buildWaf,
  buildAuthAlarms,
  buildBannedCustomerDynamoDB,
  buildAuthCache,
  createInfra,
} from './main.js';

function makeStack(): [cdk.Stack, cdk.App] {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-2' },
  });
  return [stack, app];
}

function makeCtx(stack: cdk.Stack, cfg: AuthEnvConfig): ServiceBuildContext {
  const vpc = ec2.Vpc.fromLookup(stack, 'Vpc', { tags: { Name: cfg.vpcTag } });
  const cluster = new ecs.Cluster(stack, 'Cluster', { vpc });
  const logGroup = new logs.LogGroup(stack, 'LogGroup');
  return { vpc, cluster, logGroup, cfg };
}

describe('configs', () => {
  it('dev config', () => {
    expect(DEV_CONFIG).toMatchObject({
      cpu: 256,
      memory: 512,
      minCapacity: 1,
      maxCapacity: 1,
      secretPath: 'komodo/dev/auth-api',
      vpcTag: 'komodo-dev',
      domainName: 'auth-dev.komodo.com',
    });
    expect(DEV_CONFIG).not.toHaveProperty('bannedCustomersTable');
    expect(DEV_CONFIG).not.toHaveProperty('elasticacheSgId');
    expect(DEV_CONFIG.downstreamUrls).toEqual([
      'http://user-api-public.komodo-dev.local:7052',
      'http://communications-api.komodo-dev.local:7081',
    ]);
    expect(DEV_CONFIG.tags).toMatchObject({ project: API_NAME, environment: 'dev' });
  });

  it('stg config', () => {
    expect(STG_CONFIG).toMatchObject({
      cpu: 512,
      memory: 1024,
      maxCapacity: 3,
      secretPath: 'komodo/staging/auth-api',
      vpcTag: 'komodo-staging',
      bannedCustomersTable: 'komodo-banned-customers-stg',
      elasticacheSgId: 'PLACEHOLDER-sg-elasticache-stg',
    });
  });

  it('prod config', () => {
    expect(PROD_CONFIG).toMatchObject({
      cpu: 1024,
      memory: 2048,
      maxCapacity: 6,
      secretPath: 'komodo/prod/auth-api',
      domainName: 'auth.komodo.com',
      bannedCustomersTable: 'komodo-banned-customers-prod',
      elasticacheSgId: 'PLACEHOLDER-sg-elasticache-prod',
    });
  });
});

describe('buildPublicContainer', () => {
  it('creates task def with correct env vars', () => {
    const [stack] = makeStack();
    const ctx = makeCtx(stack, DEV_CONFIG);
    buildPublicContainer(stack, ctx);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: `${API_NAME}-public-dev`,
          Environment: Match.arrayWith([
            Match.objectLike({ Name: 'APP_NAME', Value: API_NAME }),
            Match.objectLike({ Name: 'PORT', Value: `:${PUBLIC_PORT}` }),
            Match.objectLike({ Name: 'AWS_REGION', Value: 'us-east-2' }),
            Match.objectLike({ Name: 'BANNED_CUSTOMERS_TABLE', Value: '' }),
            Match.objectLike({ Name: 'USER_API_PRIVATE_URL', Value: 'http://user-api-public.komodo-dev.local:7052' }),
            Match.objectLike({ Name: 'COMMUNICATIONS_API_URL', Value: 'http://communications-api.komodo-dev.local:7081' }),
          ]),
        }),
      ]),
    });
  });

  it('creates ALB with HTTPS and HTTP redirect', () => {
    const [stack] = makeStack();
    const ctx = makeCtx(stack, DEV_CONFIG);
    buildPublicContainer(stack, ctx);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      Protocol: 'HTTPS',
    });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
      DefaultActions: [Match.objectLike({
        Type: 'redirect',
        RedirectConfig: Match.objectLike({ Protocol: 'HTTPS', StatusCode: 'HTTP_301' }),
      })],
    });
  });

  it('creates ALB and task security groups', () => {
    const [stack] = makeStack();
    const ctx = makeCtx(stack, DEV_CONFIG);
    buildPublicContainer(stack, ctx);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::SecurityGroup', 2);
  });

  it('grants secrets manager access', () => {
    const [stack] = makeStack();
    const ctx = makeCtx(stack, DEV_CONFIG);
    buildPublicContainer(stack, ctx);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret']),
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });

  it('configures auto-scaling', () => {
    const [stack] = makeStack();
    const ctx = makeCtx(stack, DEV_CONFIG);
    buildPublicContainer(stack, ctx);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 1);
  });
});

describe('buildPrivateContainer', () => {
  it('creates task def with correct env vars', () => {
    const [stack] = makeStack();
    const ctx = makeCtx(stack, DEV_CONFIG);
    buildPrivateContainer(stack, ctx);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: `${API_NAME}-private-dev`,
          Environment: Match.arrayWith([
            Match.objectLike({ Name: 'APP_NAME', Value: `${API_NAME}-internal` }),
            Match.objectLike({ Name: 'PORT_PRIVATE', Value: `:${PRIVATE_PORT}` }),
            Match.objectLike({ Name: 'AWS_REGION', Value: 'us-east-2' }),
          ]),
        }),
      ]),
    });
  });

  it('creates task security group with VPC CIDR ingress', () => {
    const [stack] = makeStack();
    const ctx = makeCtx(stack, DEV_CONFIG);
    buildPrivateContainer(stack, ctx);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::SecurityGroup', 1);
  });
});

describe('buildWaf', () => {
  it('creates WebACL with managed rules and rate limits', () => {
    const [stack] = makeStack();
    const ctx = makeCtx(stack, DEV_CONFIG);
    const pub = buildPublicContainer(stack, ctx);
    buildWaf(stack, pub.alb);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'REGIONAL',
      Rules: Match.arrayWith([
        Match.objectLike({ Name: 'AWSManagedRulesCommonRuleSet' }),
        Match.objectLike({ Name: 'AWSManagedRulesKnownBadInputsRuleSet' }),
        Match.objectLike({ Name: 'OtpRateLimit' }),
        Match.objectLike({ Name: 'PasskeyRateLimit' }),
      ]),
    });
    template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
  });
});

describe('buildAuthAlarms', () => {
  it('creates metric filters and alarms', () => {
    const [stack] = makeStack();
    const ctx = makeCtx(stack, DEV_CONFIG);
    const pub = buildPublicContainer(stack, ctx);
    buildAuthAlarms(stack, ctx.logGroup, pub.alb);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::Logs::MetricFilter', 5);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 10);
  });
});

describe('buildBannedCustomerDynamoDB', () => {
  it('grants DynamoDB read access to provided roles', () => {
    const [stack] = makeStack();
    const role = new iam.Role(stack, 'TestRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    buildBannedCustomerDynamoDB(stack, 'komodo-banned-customers-dev', role);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:GetItem']),
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });
});

describe('buildAuthCache', () => {
  it('creates security group ingress rules for each task SG', () => {
    const [stack] = makeStack();
    const vpc = ec2.Vpc.fromLookup(stack, 'Vpc', { tags: { Name: 'test' } });
    const sg1 = new ec2.SecurityGroup(stack, 'SG1', { vpc });
    const sg2 = new ec2.SecurityGroup(stack, 'SG2', { vpc });
    buildAuthCache(stack, [sg1, sg2], 'sg-placeholder');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 2);
    template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
      GroupId: 'sg-placeholder',
      IpProtocol: 'tcp',
      FromPort: 6379,
      ToPort: 6379,
    });
  });
});

describe('buildStack', () => {
  it('creates minimal dev stack with public and private services', () => {
    const [stack] = makeStack();
    buildStack(stack, DEV_CONFIG);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ECS::TaskDefinition', 2);
    template.resourceCountIs('AWS::ECS::Service', 2);
    template.hasOutput('AlbDnsName', {});
    template.hasOutput('ClusterName', {});
    template.hasOutput('PublicServiceName', {});
    template.hasOutput('PrivateServiceName', {});
    template.hasOutput('DomainName', {});

    expect(() => template.hasOutput('WafWebAclArn', {})).toThrow();
    expect(() => template.hasOutput('BannedCustomersTableName', {})).toThrow();
    expect(() => template.hasOutput('ElastiCacheSgId', {})).toThrow();
  });

  it('creates full stack for stg with all components and outputs', () => {
    const [stack] = makeStack();
    buildStack(stack, STG_CONFIG);
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::ECS::TaskDefinition', 2);
    template.resourceCountIs('AWS::ECS::Service', 2);
    template.hasOutput('AlbDnsName', {});
    template.hasOutput('ClusterName', {});
    template.hasOutput('PublicServiceName', {});
    template.hasOutput('PrivateServiceName', {});
    template.hasOutput('DomainName', {});
    template.hasOutput('WafWebAclArn', {});
    template.hasOutput('BannedCustomersTableName', {});
    template.hasOutput('ElastiCacheSgId', {});
  });

  it('applies tags from config', () => {
    const [stack] = makeStack();
    buildStack(stack, DEV_CONFIG);
    const template = Template.fromStack(stack);
    const cluster = template.findResources('AWS::ECS::Cluster');
    const clusterTags = Object.values(cluster)[0]?.Properties?.Tags;

    expect(clusterTags).toContainEqual({ Key: 'project', Value: API_NAME });
    expect(clusterTags).toContainEqual({ Key: 'dataClassification', Value: 'sensitive' });
  });

  it('scales with prod config', () => {
    const [stack] = makeStack();
    buildStack(stack, PROD_CONFIG);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '1024',
      Memory: '2048',
    });
  });
});

describe('createInfra', () => {
  it('exits with error when env context is missing', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    createInfra();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith('failed to create infrastructure:', expect.any(Error));

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
