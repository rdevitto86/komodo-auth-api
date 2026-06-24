"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStack = createStack;
const cdk = __importStar(require("aws-cdk-lib"));
const acm = __importStar(require("aws-cdk-lib/aws-certificatemanager"));
const cloudfront = __importStar(require("aws-cdk-lib/aws-cloudfront"));
const origins = __importStar(require("aws-cdk-lib/aws-cloudfront-origins"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const elasticloadbalancingv2 = __importStar(require("aws-cdk-lib/aws-elasticloadbalancingv2"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const wafv2 = __importStar(require("aws-cdk-lib/aws-wafv2"));
function createStack(scope, id, cfg, props) {
    const stack = new cdk.Stack(scope, id, props);
    const logGroupName = `/ecs/komodo-auth-${cfg.name}`;
    const logGroup = new logs.LogGroup(stack, 'LogGroup', {
        logGroupName,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const taskDef = new ecs.FargateTaskDefinition(stack, 'TaskDef', {
        cpu: cfg.cpu,
        memoryLimitMiB: cfg.memory,
    });
    secretsmanager.Secret.fromSecretNameV2(stack, 'AuthSecret', cfg.secretPath).grantRead(taskDef.taskRole);
    const publicRepo = ecr.Repository.fromRepositoryName(stack, 'PublicRepo', 'komodo-auth-api-public');
    const privateRepo = ecr.Repository.fromRepositoryName(stack, 'PrivateRepo', 'komodo-auth-api-private');
    const publicImage = ecs.ContainerImage.fromEcrRepository(publicRepo, 'latest');
    const privateImage = ecs.ContainerImage.fromEcrRepository(privateRepo, 'latest');
    const version = 'latest';
    addPublicContainer(taskDef, logGroup, publicImage, version, cfg.userApiUrl, cfg.commsApiUrl, cfg.secretPath);
    addPrivateContainer(taskDef, logGroup, privateImage, version, cfg.secretPath);
    const vpc = ec2.Vpc.fromLookup(stack, 'Vpc', {
        tags: {
            Name: cfg.vpcTag,
        },
    });
    const albSg = new ec2.SecurityGroup(stack, 'AlbSG', {
        vpc,
        description: 'ALB ingress',
        allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'http');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'https');
    const taskSg = new ec2.SecurityGroup(stack, 'TaskSG', {
        vpc,
        description: 'Fargate task',
        allowAllOutbound: true,
    });
    taskSg.addIngressRule(albSg, ec2.Port.tcp(7011), 'public from alb');
    taskSg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(7012), 'private from vpc');
    const cluster = new ecs.Cluster(stack, 'Cluster', {
        vpc,
        clusterName: `komodo-auth-${cfg.name}`,
    });
    const svc = new ecs.FargateService(stack, 'Service', {
        cluster,
        taskDefinition: taskDef,
        desiredCount: cfg.minCapacity,
        securityGroups: [taskSg],
        assignPublicIp: false,
        serviceName: `komodo-auth-${cfg.name}`,
    });
    const alb = new elasticloadbalancingv2.ApplicationLoadBalancer(stack, 'ALB', {
        vpc,
        internetFacing: true,
        securityGroup: albSg,
    });
    alb.addListener('HttpListener', {
        port: 80,
        protocol: elasticloadbalancingv2.ApplicationProtocol.HTTP,
        defaultAction: elasticloadbalancingv2.ListenerAction.redirect({
            protocol: 'HTTPS',
            port: '443',
            permanent: true,
        }),
    });
    const certificate = acm.Certificate.fromCertificateArn(stack, 'Certificate', cfg.certificateArn);
    const httpsListener = alb.addListener('HttpsListener', {
        port: 443,
        protocol: elasticloadbalancingv2.ApplicationProtocol.HTTPS,
        sslPolicy: elasticloadbalancingv2.SslPolicy.RECOMMENDED_TLS,
        certificates: [certificate],
    });
    httpsListener.addTargets('PublicTarget', {
        port: 7011,
        protocol: elasticloadbalancingv2.ApplicationProtocol.HTTP,
        targets: [svc.loadBalancerTarget({
                containerName: 'public',
                containerPort: 7011,
            })],
        healthCheck: {
            path: '/health',
            port: '7011',
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(5),
        },
    });
    const scaling = svc.autoScaleTaskCount({
        minCapacity: cfg.minCapacity,
        maxCapacity: cfg.maxCapacity,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', {
        targetUtilizationPercent: 70,
    });
    addCloudWatchAlarms(stack, svc, alb);
    addAuthAlarms(stack, logGroup, alb);
    const webAcl = addWafWebAcl(stack, alb);
    if (cfg.cloudfrontEnabled) {
        addCloudFront(stack, alb, cfg);
    }
    new cdk.CfnOutput(stack, 'AlbDnsName', {
        value: alb.loadBalancerDnsName,
        description: 'ALB DNS',
    });
    new cdk.CfnOutput(stack, 'ClusterName', {
        value: cluster.clusterName,
        description: 'ECS cluster',
    });
    new cdk.CfnOutput(stack, 'ServiceName', {
        value: svc.serviceName,
        description: 'ECS service',
    });
    new cdk.CfnOutput(stack, 'DomainName', {
        value: cfg.domainName,
        description: 'Service domain',
    });
    new cdk.CfnOutput(stack, 'WafWebAclArn', {
        value: webAcl.attrArn,
        description: 'WAF WebACL ARN',
    });
    return stack;
}
function addPublicContainer(taskDef, logGroup, image, version, userApiUrl, commsApiUrl, secretPath) {
    const env = {
        APP_NAME: 'komodo-auth-api',
        PORT: ':7011',
        VERSION: version,
        EVAL_RULES_PATH: '/app/config/validation_rules.yaml',
        USER_API_PRIVATE_URL: userApiUrl,
        COMMUNICATIONS_API_URL: commsApiUrl,
        AWS_SECRET_PATH: secretPath,
    };
    taskDef.addContainer('public', {
        image,
        essential: true,
        containerName: 'public',
        portMappings: [{
                containerPort: 7011,
                protocol: ecs.Protocol.TCP,
            }],
        healthCheck: {
            command: ['CMD', '/komodo', '-healthcheck'],
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(5),
            retries: 3,
            startPeriod: cdk.Duration.seconds(10),
        },
        environment: env,
        logging: ecs.LogDrivers.awsLogs({
            logGroup,
            streamPrefix: 'public',
        }),
    });
}
function addPrivateContainer(taskDef, logGroup, image, version, secretPath) {
    const env = {
        APP_NAME: 'komodo-auth-api-internal',
        PORT_PRIVATE: ':7012',
        VERSION: version,
        AWS_SECRET_PATH: secretPath,
    };
    taskDef.addContainer('private', {
        image,
        essential: true,
        containerName: 'private',
        portMappings: [{
                containerPort: 7012,
                protocol: ecs.Protocol.TCP,
            }],
        healthCheck: {
            command: ['CMD', '/komodo', '-healthcheck'],
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(5),
            retries: 3,
            startPeriod: cdk.Duration.seconds(10),
        },
        environment: env,
        logging: ecs.LogDrivers.awsLogs({
            logGroup,
            streamPrefix: 'private',
        }),
    });
}
function addCloudWatchAlarms(stack, svc, alb) {
    const cpuMetric = svc.metricCpuUtilization();
    new cloudwatch.Alarm(stack, 'CpuHighAlarm', {
        metric: cpuMetric,
        threshold: 80,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const memMetric = svc.metricMemoryUtilization();
    new cloudwatch.Alarm(stack, 'MemoryHighAlarm', {
        metric: memMetric,
        threshold: 80,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const unhealthyMetric = new cloudwatch.Metric({
        metricName: 'UnHealthyHostCount',
        namespace: 'AWS/ApplicationELB',
        dimensionsMap: {
            LoadBalancer: alb.loadBalancerArn,
        },
        statistic: 'Average',
        period: cdk.Duration.seconds(60),
    });
    new cloudwatch.Alarm(stack, 'UnhealthyTargetsAlarm', {
        metric: unhealthyMetric,
        threshold: 1,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const errorMetric = new cloudwatch.Metric({
        metricName: 'HTTPCode_Target_5XX',
        namespace: 'AWS/ApplicationELB',
        dimensionsMap: {
            LoadBalancer: alb.loadBalancerArn,
        },
        statistic: 'Sum',
        period: cdk.Duration.seconds(60),
    });
    new cloudwatch.Alarm(stack, 'High5xxErrorAlarm', {
        metric: errorMetric,
        threshold: 5,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
}
function addAuthAlarms(stack, logGroup, alb) {
    const issuance5xxFilter = new logs.MetricFilter(stack, 'Issuance5xxFilter', {
        logGroup,
        filterPattern: logs.FilterPattern.literal('{ $.status >= 500 && ($.path = "/v1/oauth/token" || $.path = "/v1/otp/verify") }'),
        metricNamespace: 'KomodoAuth',
        metricName: 'Issuance5xxCount',
        metricValue: '1',
        defaultValue: 0,
    });
    new cloudwatch.Alarm(stack, 'Issuance5xxAlarm', {
        metric: issuance5xxFilter.metric({
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
        }),
        threshold: 10,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const otpAbuseFilter = new logs.MetricFilter(stack, 'OtpAbuseFilter', {
        logGroup,
        filterPattern: logs.FilterPattern.literal('{ $.status = 429 && $.path = "/v1/otp/*" }'),
        metricNamespace: 'KomodoAuth',
        metricName: 'OtpAbuse429Count',
        metricValue: '1',
        defaultValue: 0,
    });
    new cloudwatch.Alarm(stack, 'OtpAbuseAlarm', {
        metric: otpAbuseFilter.metric({
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
        }),
        threshold: 50,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const otpBruteForceFilter = new logs.MetricFilter(stack, 'OtpBruteForceFilter', {
        logGroup,
        filterPattern: logs.FilterPattern.literal('{ $.status = 401 && $.path = "/v1/otp/verify" }'),
        metricNamespace: 'KomodoAuth',
        metricName: 'OtpBruteForce401Count',
        metricValue: '1',
        defaultValue: 0,
    });
    new cloudwatch.Alarm(stack, 'OtpBruteForceAlarm', {
        metric: otpBruteForceFilter.metric({
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
        }),
        threshold: 100,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const latencyMetric = new cloudwatch.Metric({
        metricName: 'TargetResponseTime',
        namespace: 'AWS/ApplicationELB',
        dimensionsMap: {
            LoadBalancer: alb.loadBalancerArn,
        },
        statistic: 'p99',
        period: cdk.Duration.seconds(60),
    });
    new cloudwatch.Alarm(stack, 'LatencyP99Alarm', {
        metric: latencyMetric,
        threshold: 0.5,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
}
function addWafWebAcl(stack, alb) {
    const webAcl = new wafv2.CfnWebACL(stack, 'WafWebAcl', {
        defaultAction: { allow: {} },
        scope: 'REGIONAL',
        visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'KomodoAuthWaf',
        },
        rules: [
            {
                name: 'AWSManagedRulesCommonRuleSet',
                priority: 1,
                overrideAction: { none: {} },
                statement: {
                    managedRuleGroupStatement: {
                        vendorName: 'AWS',
                        name: 'AWSManagedRulesCommonRuleSet',
                    },
                },
                visibilityConfig: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: 'AWSManagedRulesCommonRuleSet',
                },
            },
            {
                name: 'AWSManagedRulesKnownBadInputsRuleSet',
                priority: 2,
                overrideAction: { none: {} },
                statement: {
                    managedRuleGroupStatement: {
                        vendorName: 'AWS',
                        name: 'AWSManagedRulesKnownBadInputsRuleSet',
                    },
                },
                visibilityConfig: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
                },
            },
            {
                name: 'GlobalRateLimit',
                priority: 3,
                action: { block: {} },
                statement: {
                    rateBasedStatement: {
                        limit: 2000,
                        aggregateKeyType: 'IP',
                    },
                },
                visibilityConfig: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: 'GlobalRateLimit',
                },
            },
            {
                name: 'OtpRateLimit',
                priority: 4,
                action: { block: {} },
                statement: {
                    rateBasedStatement: {
                        limit: 100,
                        aggregateKeyType: 'IP',
                        scopeDownStatement: {
                            byteMatchStatement: {
                                searchString: '/v1/otp/',
                                fieldToMatch: { uriPath: {} },
                                textTransformations: [{ priority: 0, type: 'NONE' }],
                                positionalConstraint: 'STARTS_WITH',
                            },
                        },
                    },
                },
                visibilityConfig: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: 'OtpRateLimit',
                },
            },
            {
                name: 'PasskeyRateLimit',
                priority: 5,
                action: { block: {} },
                statement: {
                    rateBasedStatement: {
                        limit: 100,
                        aggregateKeyType: 'IP',
                        scopeDownStatement: {
                            byteMatchStatement: {
                                searchString: '/v1/passkeys/',
                                fieldToMatch: { uriPath: {} },
                                textTransformations: [{ priority: 0, type: 'NONE' }],
                                positionalConstraint: 'STARTS_WITH',
                            },
                        },
                    },
                },
                visibilityConfig: {
                    sampledRequestsEnabled: true,
                    cloudWatchMetricsEnabled: true,
                    metricName: 'PasskeyRateLimit',
                },
            },
        ],
    });
    new wafv2.CfnWebACLAssociation(stack, 'WafAlbAssociation', {
        webAclArn: webAcl.attrArn,
        resourceArn: alb.loadBalancerArn,
    });
    return webAcl;
}
function addCloudFront(stack, alb, cfg) {
    const origin = new origins.HttpOrigin(alb.loadBalancerDnsName, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });
    const hasCert = cfg.cloudFrontCertificateArn !== '';
    const distProps = {
        defaultBehavior: {
            origin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        additionalBehaviors: {
            '/.well-known/jwks.json': {
                origin,
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                cachePolicy: new cloudfront.CachePolicy(stack, 'JwksCachePolicy', {
                    defaultTtl: cdk.Duration.minutes(5),
                    maxTtl: cdk.Duration.hours(1),
                    minTtl: cdk.Duration.seconds(0),
                }),
            },
        },
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        ...(hasCert && {
            domainNames: [cfg.domainName],
            certificate: acm.Certificate.fromCertificateArn(stack, 'CloudFrontCertificate', cfg.cloudFrontCertificateArn),
        }),
    };
    const distribution = new cloudfront.Distribution(stack, 'Distribution', distProps);
    new cdk.CfnOutput(stack, 'CloudFrontDomainName', {
        value: distribution.distributionDomainName,
    });
    return distribution;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQWVBLGtDQWtKQztBQWpLRCxpREFBbUM7QUFDbkMsd0VBQTBEO0FBQzFELHVFQUF5RDtBQUN6RCw0RUFBOEQ7QUFDOUQsdUVBQXlEO0FBQ3pELHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLCtGQUFpRjtBQUNqRiwyREFBNkM7QUFDN0MsK0VBQWlFO0FBQ2pFLDZEQUErQztBQUkvQyxTQUFnQixXQUFXLENBQ3pCLEtBQWdCLEVBQ2hCLEVBQVUsRUFDVixHQUFjLEVBQ2QsS0FBcUI7SUFFckIsTUFBTSxLQUFLLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFFOUMsTUFBTSxZQUFZLEdBQUcsb0JBQW9CLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUVwRCxNQUFNLFFBQVEsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxFQUFFLFVBQVUsRUFBRTtRQUNwRCxZQUFZO1FBQ1osU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUztRQUN2QyxhQUFhLEVBQUUsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO0tBQ3pDLENBQUMsQ0FBQztJQUVILE1BQU0sT0FBTyxHQUFHLElBQUksR0FBRyxDQUFDLHFCQUFxQixDQUFDLEtBQUssRUFBRSxTQUFTLEVBQUU7UUFDOUQsR0FBRyxFQUFFLEdBQUcsQ0FBQyxHQUFHO1FBQ1osY0FBYyxFQUFFLEdBQUcsQ0FBQyxNQUFNO0tBQzNCLENBQUMsQ0FBQztJQUVILGNBQWMsQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxFQUFFLFlBQVksRUFBRSxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsU0FBUyxD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Q2IsV0FBVyxFQUFFLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQztZQUM3QixXQUFXLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxrQkFBa0IsQ0FDN0MsS0FBSyxFQUNMLHVCQUF1QixFQUN2QixHQUFHLENBQUMsd0JBQXdCLENBQzdCO1NBQ0YsQ0FBQztLQUNILENBQUM7SUFFRixNQUFNLFlBQVksR0FBRyxJQUFJLFVBQVUsQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLGNBQWMsRUFBRSxTQUFTLENBQUMsQ0FBQztJQUVuRixJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLHNCQUFzQixFQUFFO1FBQy9DLEtBQUssRUFBRSxZQUFZLENBQUMsc0JBQXNCO0tBQzNDLENBQUMsQ0FBQztJQUVILE9BQU8sWUFBWSxDQUFDO0FBQ3RCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgYWNtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jZXJ0aWZpY2F0ZW1hbmFnZXInO1xuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udCc7XG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnMnO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgKiBhcyBlY3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcyc7XG5pbXBvcnQgKiBhcyBlbGFzdGljbG9hZGJhbGFuY2luZ3YyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lbGFzdGljbG9hZGJhbGFuY2luZ3YyJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcbmltcG9ydCAqIGFzIHdhZnYyIGZyb20gJ2F3cy1jZGstbGliL2F3cy13YWZ2Mic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEVudkNvbmZpZyB9IGZyb20gJy4vY29uZmlnJztcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVN0YWNrKFxuICBzY29wZTogQ29uc3RydWN0LFxuICBpZDogc3RyaW5nLFxuICBjZmc6IEVudkNvbmZpZyxcbiAgcHJvcHM6IGNkay5TdGFja1Byb3BzLFxuKTogY2RrLlN0YWNrIHtcbiAgY29uc3Qgc3RhY2sgPSBuZXcgY2RrLlN0YWNrKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gIGNvbnN0IGxvZ0dyb3VwTmFtZSA9IGAvZWNzL2tvbW9kby1hdXRoLSR7Y2ZnLm5hbWV9YDtcblxuICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHN0YWNrLCAnTG9nR3JvdXAnLCB7XG4gICAgbG9nR3JvdXBOYW1lLFxuICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICB9KTtcblxuICBjb25zdCB0YXNrRGVmID0gbmV3IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24oc3RhY2ssICdUYXNrRGVmJywge1xuICAgIGNwdTogY2ZnLmNwdSxcbiAgICBtZW1vcnlMaW1pdE1pQjogY2ZnLm1lbW9yeSxcbiAgfSk7XG5cbiAgc2VjcmV0c21hbmFnZXIuU2VjcmV0LmZyb21TZWNyZXROYW1lVjIoc3RhY2ssICdBdXRoU2VjcmV0JywgY2ZnLnNlY3JldFBhdGgpLmdyYW50UmVhZCh0YXNrRGVmLnRhc2tSb2xlKTtcbiAgY29uc3QgcHVibGljUmVwbyA9IGVjci5SZXBvc2l0b3J5LmZyb21SZXBvc2l0b3J5TmFtZShzdGFjaywgJ1B1YmxpY1JlcG8nLCAna29tb2RvLWF1dGgtYXBpLXB1YmxpYycpO1xuICBjb25zdCBwcml2YXRlUmVwbyA9IGVjci5SZXBvc2l0b3J5LmZyb21SZXBvc2l0b3J5TmFtZShzdGFjaywgJ1ByaXZhdGVSZXBvJywgJ2tvbW9kby1hdXRoLWFwaS1wcml2YXRlJyk7XG4gIGNvbnN0IHB1YmxpY0ltYWdlID0gZWNzLkNvbnRhaW5lckltYWdlLmZyb21FY3JSZXBvc2l0b3J5KHB1YmxpY1JlcG8sICdsYXRlc3QnKTtcbiAgY29uc3QgcHJpdmF0ZUltYWdlID0gZWNzLkNvbnRhaW5lckltYWdlLmZyb21FY3JSZXBvc2l0b3J5KHByaXZhdGVSZXBvLCAnbGF0ZXN0Jyk7XG5cbiAgY29uc3QgdmVyc2lvbiA9ICdsYXRlc3QnO1xuXG4gIGFkZFB1YmxpY0NvbnRhaW5lcih0YXNrRGVmLCBsb2dHcm91cCwgcHVibGljSW1hZ2UsIHZlcnNpb24sIGNmZy51c2VyQXBpVXJsLCBjZmcuY29tbXNBcGlVcmwsIGNmZy5zZWNyZXRQYXRoKTtcbiAgYWRkUHJpdmF0ZUNvbnRhaW5lcih0YXNrRGVmLCBsb2dHcm91cCwgcHJpdmF0ZUltYWdlLCB2ZXJzaW9uLCBjZmcuc2VjcmV0UGF0aCk7XG5cbiAgY29uc3QgdnBjID0gZWMyLlZwYy5mcm9tTG9va3VwKHN0YWNrLCAnVnBjJywge1xuICAgIHRhZ3M6IHtcbiAgICAgIE5hbWU6IGNmZy52cGNUYWcsXG4gICAgfSxcbiAgfSk7XG5cbiAgY29uc3QgYWxiU2cgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAoc3RhY2ssICdBbGJTRycsIHtcbiAgICB2cGMsXG4gICAgZGVzY3JpcHRpb246ICdBTEIgaW5ncmVzcycsXG4gICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgfSk7XG4gIGFsYlNnLmFkZEluZ3Jlc3NSdWxlKGVjMi5QZWVyLmFueUlwdjQoKSwgZWMyLlBvcnQudGNwKDgwKSwgJ2h0dHAnKTtcbiAgYWxiU2cuYWRkSW5ncmVzc1J1bGUoZWMyLlBlZXIuYW55SXB2NCgpLCBlYzIuUG9ydC50Y3AoNDQzKSwgJ2h0dHBzJyk7XG5cbiAgY29uc3QgdGFza1NnID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHN0YWNrLCAnVGFza1NHJywge1xuICAgIHZwYyxcbiAgICBkZXNjcmlwdGlvbjogJ0ZhcmdhdGUgdGFzaycsXG4gICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgfSk7XG4gIHRhc2tTZy5hZGRJbmdyZXNzUnVsZShhbGJTZywgZWMyLlBvcnQudGNwKDcwMTEpLCAncHVibGljIGZyb20gYWxiJyk7XG4gIHRhc2tTZy5hZGRJbmdyZXNzUnVsZShlYzIuUGVlci5pcHY0KHZwYy52cGNDaWRyQmxvY2spLCBlYzIuUG9ydC50Y3AoNzAxMiksICdwcml2YXRlIGZyb20gdnBjJyk7XG5cbiAgY29uc3QgY2x1c3RlciA9IG5ldyBlY3MuQ2x1c3RlcihzdGFjaywgJ0NsdXN0ZXInLCB7XG4gICAgdnBjLFxuICAgIGNsdXN0ZXJOYW1lOiBga29tb2RvLWF1dGgtJHtjZmcubmFtZX1gLFxuICB9KTtcblxuICBjb25zdCBzdmMgPSBuZXcgZWNzLkZhcmdhdGVTZXJ2aWNlKHN0YWNrLCAnU2VydmljZScsIHtcbiAgICBjbHVzdGVyLFxuICAgIHRhc2tEZWZpbml0aW9uOiB0YXNrRGVmLFxuICAgIGRlc2lyZWRDb3VudDogY2ZnLm1pbkNhcGFjaXR5LFxuICAgIHNlY3VyaXR5R3JvdXBzOiBbdGFza1NnXSxcbiAgICBhc3NpZ25QdWJsaWNJcDogZmFsc2UsXG4gICAgc2VydmljZU5hbWU6IGBrb21vZG8tYXV0aC0ke2NmZy5uYW1lfWAsXG4gIH0pO1xuXG4gIGNvbnN0IGFsYiA9IG5ldyBlbGFzdGljbG9hZGJhbGFuY2luZ3YyLkFwcGxpY2F0aW9uTG9hZEJhbGFuY2VyKHN0YWNrLCAnQUxCJywge1xuICAgIHZwYyxcbiAgICBpbnRlcm5ldEZhY2luZzogdHJ1ZSxcbiAgICBzZWN1cml0eUdyb3VwOiBhbGJTZyxcbiAgfSk7XG5cbiAgYWxiLmFkZExpc3RlbmVyKCdIdHRwTGlzdGVuZXInLCB7XG4gICAgcG9ydDogODAsXG4gICAgcHJvdG9jb2w6IGVsYXN0aWNsb2FkYmFsYW5jaW5ndjIuQXBwbGljYXRpb25Qcm90b2NvbC5IVFRQLFxuICAgIGRlZmF1bHRBY3Rpb246IGVsYXN0aWNsb2FkYmFsYW5jaW5ndjIuTGlzdGVuZXJBY3Rpb24ucmVkaXJlY3Qoe1xuICAgICAgcHJvdG9jb2w6ICdIVFRQUycsXG4gICAgICBwb3J0OiAnNDQzJyxcbiAgICAgIHBlcm1hbmVudDogdHJ1ZSxcbiAgICB9KSxcbiAgfSk7XG5cbiAgY29uc3QgY2VydGlmaWNhdGUgPSBhY20uQ2VydGlmaWNhdGUuZnJvbUNlcnRpZmljYXRlQXJuKHN0YWNrLCAnQ2VydGlmaWNhdGUnLCBjZmcuY2VydGlmaWNhdGVBcm4pO1xuXG4gIGNvbnN0IGh0dHBzTGlzdGVuZXIgPSBhbGIuYWRkTGlzdGVuZXIoJ0h0dHBzTGlzdGVuZXInLCB7XG4gICAgcG9ydDogNDQzLFxuICAgIHByb3RvY29sOiBlbGFzdGljbG9hZGJhbGFuY2luZ3YyLkFwcGxpY2F0aW9uUHJvdG9jb2wuSFRUUFMsXG4gICAgc3NsUG9saWN5OiBlbGFzdGljbG9hZGJhbGFuY2luZ3YyLlNzbFBvbGljeS5SRUNPTU1FTkRFRF9UTFMsXG4gICAgY2VydGlmaWNhdGVzOiBbY2VydGlmaWNhdGVdLFxuICB9KTtcblxuICBodHRwc0xpc3RlbmVyLmFkZFRhcmdldHMoJ1B1YmxpY1RhcmdldCcsIHtcbiAgICBwb3J0OiA3MDExLFxuICAgIHByb3RvY29sOiBlbGFzdGljbG9hZGJhbGFuY2luZ3YyLkFwcGxpY2F0aW9uUHJvdG9jb2wuSFRUUCxcbiAgICB0YXJnZXRzOiBbc3ZjLmxvYWRCYWxhbmNlclRhcmdldCh7XG4gICAgICBjb250YWluZXJOYW1lOiAncHVibGljJyxcbiAgICAgIGNvbnRhaW5lclBvcnQ6IDcwMTEsXG4gICAgfSldLFxuICAgIGhlYWx0aENoZWNrOiB7XG4gICAgICBwYXRoOiAnL2hlYWx0aCcsXG4gICAgICBwb3J0OiAnNzAxMScsXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgfSxcbiAgfSk7XG5cbiAgY29uc3Qgc2NhbGluZyA9IHN2Yy5hdXRvU2NhbGVUYXNrQ291bnQoe1xuICAgIG1pbkNhcGFjaXR5OiBjZmcubWluQ2FwYWNpdHksXG4gICAgbWF4Q2FwYWNpdHk6IGNmZy5tYXhDYXBhY2l0eSxcbiAgfSk7XG4gIHNjYWxpbmcuc2NhbGVPbkNwdVV0aWxpemF0aW9uKCdDcHVTY2FsaW5nJywge1xuICAgIHRhcmdldFV0aWxpemF0aW9uUGVyY2VudDogNzAsXG4gIH0pO1xuXG4gIGFkZENsb3VkV2F0Y2hBbGFybXMoc3RhY2ssIHN2YywgYWxiKTtcbiAgYWRkQXV0aEFsYXJtcyhzdGFjaywgbG9nR3JvdXAsIGFsYik7XG4gIGNvbnN0IHdlYkFjbCA9IGFkZFdhZldlYkFjbChzdGFjaywgYWxiKTtcblxuICBpZiAoY2ZnLmNsb3VkZnJvbnRFbmFibGVkKSB7XG4gICAgYWRkQ2xvdWRGcm9udChzdGFjaywgYWxiLCBjZmcpO1xuICB9XG5cbiAgbmV3IGNkay5DZm5PdXRwdXQoc3RhY2ssICdBbGJEbnNOYW1lJywge1xuICAgIHZhbHVlOiBhbGIubG9hZEJhbGFuY2VyRG5zTmFtZSxcbiAgICBkZXNjcmlwdGlvbjogJ0FMQiBETlMnLFxuICB9KTtcbiAgbmV3IGNkay5DZm5PdXRwdXQoc3RhY2ssICdDbHVzdGVyTmFtZScsIHtcbiAgICB2YWx1ZTogY2x1c3Rlci5jbHVzdGVyTmFtZSxcbiAgICBkZXNjcmlwdGlvbjogJ0VDUyBjbHVzdGVyJyxcbiAgfSk7XG4gIG5ldyBjZGsuQ2ZuT3V0cHV0KHN0YWNrLCAnU2VydmljZU5hbWUnLCB7XG4gICAgdmFsdWU6IHN2Yy5zZXJ2aWNlTmFtZSxcbiAgICBkZXNjcmlwdGlvbjogJ0VDUyBzZXJ2aWNlJyxcbiAgfSk7XG4gIG5ldyBjZGsuQ2ZuT3V0cHV0KHN0YWNrLCAnRG9tYWluTmFtZScsIHtcbiAgICB2YWx1ZTogY2ZnLmRvbWFpbk5hbWUsXG4gICAgZGVzY3JpcHRpb246ICdTZXJ2aWNlIGRvbWFpbicsXG4gIH0pO1xuICBuZXcgY2RrLkNmbk91dHB1dChzdGFjaywgJ1dhZldlYkFjbEFybicsIHtcbiAgICB2YWx1ZTogd2ViQWNsLmF0dHJBcm4sXG4gICAgZGVzY3JpcHRpb246ICdXQUYgV2ViQUNMIEFSTicsXG4gIH0pO1xuXG4gIHJldHVybiBzdGFjaztcbn1cblxuZnVuY3Rpb24gYWRkUHVibGljQ29udGFpbmVyKFxuICB0YXNrRGVmOiBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uLFxuICBsb2dHcm91cDogbG9ncy5Mb2dHcm91cCxcbiAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZSxcbiAgdmVyc2lvbjogc3RyaW5nLFxuICB1c2VyQXBpVXJsOiBzdHJpbmcsXG4gIGNvbW1zQXBpVXJsOiBzdHJpbmcsXG4gIHNlY3JldFBhdGg6IHN0cmluZyxcbik6IHZvaWQge1xuICBjb25zdCBlbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgQVBQX05BTUU6ICdrb21vZG8tYXV0aC1hcGknLFxuICAgIFBPUlQ6ICc6NzAxMScsXG4gICAgVkVSU0lPTjogdmVyc2lvbixcbiAgICBFVkFMX1JVTEVTX1BBVEg6ICcvYXBwL2NvbmZpZy92YWxpZGF0aW9uX3J1bGVzLnlhbWwnLFxuICAgIFVTRVJfQVBJX1BSSVZBVEVfVVJMOiB1c2VyQXBpVXJsLFxuICAgIENPTU1VTklDQVRJT05TX0FQSV9VUkw6IGNvbW1zQXBpVXJsLFxuICAgIEFXU19TRUNSRVRfUEFUSDogc2VjcmV0UGF0aCxcbiAgfTtcblxuICB0YXNrRGVmLmFkZENvbnRhaW5lcigncHVibGljJywge1xuICAgIGltYWdlLFxuICAgIGVzc2VudGlhbDogdHJ1ZSxcbiAgICBjb250YWluZXJOYW1lOiAncHVibGljJyxcbiAgICBwb3J0TWFwcGluZ3M6IFt7XG4gICAgICBjb250YWluZXJQb3J0OiA3MDExLFxuICAgICAgcHJvdG9jb2w6IGVjcy5Qcm90b2NvbC5UQ1AsXG4gICAgfV0sXG4gICAgaGVhbHRoQ2hlY2s6IHtcbiAgICAgIGNvbW1hbmQ6IFsnQ01EJywgJy9rb21vZG8nLCAnLWhlYWx0aGNoZWNrJ10sXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICByZXRyaWVzOiAzLFxuICAgICAgc3RhcnRQZXJpb2Q6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEwKSxcbiAgICB9LFxuICAgIGVudmlyb25tZW50OiBlbnYsXG4gICAgbG9nZ2luZzogZWNzLkxvZ0RyaXZlcnMuYXdzTG9ncyh7XG4gICAgICBsb2dHcm91cCxcbiAgICAgIHN0cmVhbVByZWZpeDogJ3B1YmxpYycsXG4gICAgfSksXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBhZGRQcml2YXRlQ29udGFpbmVyKFxuICB0YXNrRGVmOiBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uLFxuICBsb2dHcm91cDogbG9ncy5Mb2dHcm91cCxcbiAgaW1hZ2U6IGVjcy5Db250YWluZXJJbWFnZSxcbiAgdmVyc2lvbjogc3RyaW5nLFxuICBzZWNyZXRQYXRoOiBzdHJpbmcsXG4pOiB2b2lkIHtcbiAgY29uc3QgZW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgIEFQUF9OQU1FOiAna29tb2RvLWF1dGgtYXBpLWludGVybmFsJyxcbiAgICBQT1JUX1BSSVZBVEU6ICc6NzAxMicsXG4gICAgVkVSU0lPTjogdmVyc2lvbixcbiAgICBBV1NfU0VDUkVUX1BBVEg6IHNlY3JldFBhdGgsXG4gIH07XG5cbiAgdGFza0RlZi5hZGRDb250YWluZXIoJ3ByaXZhdGUnLCB7XG4gICAgaW1hZ2UsXG4gICAgZXNzZW50aWFsOiB0cnVlLFxuICAgIGNvbnRhaW5lck5hbWU6ICdwcml2YXRlJyxcbiAgICBwb3J0TWFwcGluZ3M6IFt7XG4gICAgICBjb250YWluZXJQb3J0OiA3MDEyLFxuICAgICAgcHJvdG9jb2w6IGVjcy5Qcm90b2NvbC5UQ1AsXG4gICAgfV0sXG4gICAgaGVhbHRoQ2hlY2s6IHtcbiAgICAgIGNvbW1hbmQ6IFsnQ01EJywgJy9rb21vZG8nLCAnLWhlYWx0aGNoZWNrJ10sXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICByZXRyaWVzOiAzLFxuICAgICAgc3RhcnRQZXJpb2Q6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDEwKSxcbiAgICB9LFxuICAgIGVudmlyb25tZW50OiBlbnYsXG4gICAgbG9nZ2luZzogZWNzLkxvZ0RyaXZlcnMuYXdzTG9ncyh7XG4gICAgICBsb2dHcm91cCxcbiAgICAgIHN0cmVhbVByZWZpeDogJ3ByaXZhdGUnLFxuICAgIH0pLFxuICB9KTtcbn1cblxuZnVuY3Rpb24gYWRkQ2xvdWRXYXRjaEFsYXJtcyhcbiAgc3RhY2s6IGNkay5TdGFjayxcbiAgc3ZjOiBlY3MuRmFyZ2F0ZVNlcnZpY2UsXG4gIGFsYjogZWxhc3RpY2xvYWRiYWxhbmNpbmd2Mi5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlcixcbik6IHZvaWQge1xuICBjb25zdCBjcHVNZXRyaWMgPSBzdmMubWV0cmljQ3B1VXRpbGl6YXRpb24oKTtcbiAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0oc3RhY2ssICdDcHVIaWdoQWxhcm0nLCB7XG4gICAgbWV0cmljOiBjcHVNZXRyaWMsXG4gICAgdGhyZXNob2xkOiA4MCxcbiAgICBldmFsdWF0aW9uUGVyaW9kczogMyxcbiAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gIH0pO1xuXG4gIGNvbnN0IG1lbU1ldHJpYyA9IHN2Yy5tZXRyaWNNZW1vcnlVdGlsaXphdGlvbigpO1xuICBuZXcgY2xvdWR3YXRjaC5BbGFybShzdGFjaywgJ01lbW9yeUhpZ2hBbGFybScsIHtcbiAgICBtZXRyaWM6IG1lbU1ldHJpYyxcbiAgICB0aHJlc2hvbGQ6IDgwLFxuICAgIGV2YWx1YXRpb25QZXJpb2RzOiAzLFxuICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgfSk7XG5cbiAgY29uc3QgdW5oZWFsdGh5TWV0cmljID0gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICBtZXRyaWNOYW1lOiAnVW5IZWFsdGh5SG9zdENvdW50JyxcbiAgICBuYW1lc3BhY2U6ICdBV1MvQXBwbGljYXRpb25FTEInLFxuICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgIExvYWRCYWxhbmNlcjogYWxiLmxvYWRCYWxhbmNlckFybixcbiAgICB9LFxuICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNjApLFxuICB9KTtcbiAgbmV3IGNsb3Vkd2F0Y2guQWxhcm0oc3RhY2ssICdVbmhlYWx0aHlUYXJnZXRzQWxhcm0nLCB7XG4gICAgbWV0cmljOiB1bmhlYWx0aHlNZXRyaWMsXG4gICAgdGhyZXNob2xkOiAxLFxuICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgfSk7XG5cbiAgY29uc3QgZXJyb3JNZXRyaWMgPSBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgIG1ldHJpY05hbWU6ICdIVFRQQ29kZV9UYXJnZXRfNVhYJyxcbiAgICBuYW1lc3BhY2U6ICdBV1MvQXBwbGljYXRpb25FTEInLFxuICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgIExvYWRCYWxhbmNlcjogYWxiLmxvYWRCYWxhbmNlckFybixcbiAgICB9LFxuICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gIH0pO1xuICBuZXcgY2xvdWR3YXRjaC5BbGFybShzdGFjaywgJ0hpZ2g1eHhFcnJvckFsYXJtJywge1xuICAgIG1ldHJpYzogZXJyb3JNZXRyaWMsXG4gICAgdGhyZXNob2xkOiA1LFxuICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGFkZEF1dGhBbGFybXMoXG4gIHN0YWNrOiBjZGsuU3RhY2ssXG4gIGxvZ0dyb3VwOiBsb2dzLkxvZ0dyb3VwLFxuICBhbGI6IGVsYXN0aWNsb2FkYmFsYW5jaW5ndjIuQXBwbGljYXRpb25Mb2FkQmFsYW5jZXIsXG4pOiB2b2lkIHtcbiAgY29uc3QgaXNzdWFuY2U1eHhGaWx0ZXIgPSBuZXcgbG9ncy5NZXRyaWNGaWx0ZXIoc3RhY2ssICdJc3N1YW5jZTV4eEZpbHRlcicsIHtcbiAgICBsb2dHcm91cCxcbiAgICBmaWx0ZXJQYXR0ZXJuOiBsb2dzLkZpbHRlclBhdHRlcm4ubGl0ZXJhbCgneyAkLnN0YXR1cyA+PSA1MDAgJiYgKCQucGF0aCA9IFwiL3YxL29hdXRoL3Rva2VuXCIgfHwgJC5wYXRoID0gXCIvdjEvb3RwL3ZlcmlmeVwiKSB9JyksXG4gICAgbWV0cmljTmFtZXNwYWNlOiAnS29tb2RvQXV0aCcsXG4gICAgbWV0cmljTmFtZTogJ0lzc3VhbmNlNXh4Q291bnQnLFxuICAgIG1ldHJpY1ZhbHVlOiAnMScsXG4gICAgZGVmYXVsdFZhbHVlOiAwLFxuICB9KTtcblxuICBuZXcgY2xvdWR3YXRjaC5BbGFybShzdGFjaywgJ0lzc3VhbmNlNXh4QWxhcm0nLCB7XG4gICAgbWV0cmljOiBpc3N1YW5jZTV4eEZpbHRlci5tZXRyaWMoe1xuICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgfSksXG4gICAgdGhyZXNob2xkOiAxMCxcbiAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gIH0pO1xuXG4gIGNvbnN0IG90cEFidXNlRmlsdGVyID0gbmV3IGxvZ3MuTWV0cmljRmlsdGVyKHN0YWNrLCAnT3RwQWJ1c2VGaWx0ZXInLCB7XG4gICAgbG9nR3JvdXAsXG4gICAgZmlsdGVyUGF0dGVybjogbG9ncy5GaWx0ZXJQYXR0ZXJuLmxpdGVyYWwoJ3sgJC5zdGF0dXMgPSA0MjkgJiYgJC5wYXRoID0gXCIvdjEvb3RwLypcIiB9JyksXG4gICAgbWV0cmljTmFtZXNwYWNlOiAnS29tb2RvQXV0aCcsXG4gICAgbWV0cmljTmFtZTogJ090cEFidXNlNDI5Q291bnQnLFxuICAgIG1ldHJpY1ZhbHVlOiAnMScsXG4gICAgZGVmYXVsdFZhbHVlOiAwLFxuICB9KTtcblxuICBuZXcgY2xvdWR3YXRjaC5BbGFybShzdGFjaywgJ090cEFidXNlQWxhcm0nLCB7XG4gICAgbWV0cmljOiBvdHBBYnVzZUZpbHRlci5tZXRyaWMoe1xuICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgfSksXG4gICAgdGhyZXNob2xkOiA1MCxcbiAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gIH0pO1xuXG4gIGNvbnN0IG90cEJydXRlRm9yY2VGaWx0ZXIgPSBuZXcgbG9ncy5NZXRyaWNGaWx0ZXIoc3RhY2ssICdPdHBCcnV0ZUZvcmNlRmlsdGVyJywge1xuICAgIGxvZ0dyb3VwLFxuICAgIGZpbHRlclBhdHRlcm46IGxvZ3MuRmlsdGVyUGF0dGVybi5saXRlcmFsKCd7ICQuc3RhdHVzID0gNDAxICYmICQucGF0aCA9IFwiL3YxL290cC92ZXJpZnlcIiB9JyksXG4gICAgbWV0cmljTmFtZXNwYWNlOiAnS29tb2RvQXV0aCcsXG4gICAgbWV0cmljTmFtZTogJ090cEJydXRlRm9yY2U0MDFDb3VudCcsXG4gICAgbWV0cmljVmFsdWU6ICcxJyxcbiAgICBkZWZhdWx0VmFsdWU6IDAsXG4gIH0pO1xuXG4gIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHN0YWNrLCAnT3RwQnJ1dGVGb3JjZUFsYXJtJywge1xuICAgIG1ldHJpYzogb3RwQnJ1dGVGb3JjZUZpbHRlci5tZXRyaWMoe1xuICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgfSksXG4gICAgdGhyZXNob2xkOiAxMDAsXG4gICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICB9KTtcblxuICBjb25zdCBsYXRlbmN5TWV0cmljID0gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICBtZXRyaWNOYW1lOiAnVGFyZ2V0UmVzcG9uc2VUaW1lJyxcbiAgICBuYW1lc3BhY2U6ICdBV1MvQXBwbGljYXRpb25FTEInLFxuICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgIExvYWRCYWxhbmNlcjogYWxiLmxvYWRCYWxhbmNlckFybixcbiAgICB9LFxuICAgIHN0YXRpc3RpYzogJ3A5OScsXG4gICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gIH0pO1xuXG4gIG5ldyBjbG91ZHdhdGNoLkFsYXJtKHN0YWNrLCAnTGF0ZW5jeVA5OUFsYXJtJywge1xuICAgIG1ldHJpYzogbGF0ZW5jeU1ldHJpYyxcbiAgICB0aHJlc2hvbGQ6IDAuNSxcbiAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBhZGRXYWZXZWJBY2woXG4gIHN0YWNrOiBjZGsuU3RhY2ssXG4gIGFsYjogZWxhc3RpY2xvYWRiYWxhbmNpbmd2Mi5BcHBsaWNhdGlvbkxvYWRCYWxhbmNlcixcbik6IHdhZnYyLkNmbldlYkFDTCB7XG4gIGNvbnN0IHdlYkFjbCA9IG5ldyB3YWZ2Mi5DZm5XZWJBQ0woc3RhY2ssICdXYWZXZWJBY2wnLCB7XG4gICAgZGVmYXVsdEFjdGlvbjogeyBhbGxvdzoge30gfSxcbiAgICBzY29wZTogJ1JFR0lPTkFMJyxcbiAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgbWV0cmljTmFtZTogJ0tvbW9kb0F1dGhXYWYnLFxuICAgIH0sXG4gICAgcnVsZXM6IFtcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ0FXU01hbmFnZWRSdWxlc0NvbW1vblJ1bGVTZXQnLFxuICAgICAgICBwcmlvcml0eTogMSxcbiAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHsgbm9uZToge30gfSxcbiAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgbWFuYWdlZFJ1bGVHcm91cFN0YXRlbWVudDoge1xuICAgICAgICAgICAgdmVuZG9yTmFtZTogJ0FXUycsXG4gICAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzQ29tbW9uUnVsZVNldCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIG1ldHJpY05hbWU6ICdBV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0JyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdBV1NNYW5hZ2VkUnVsZXNLbm93bkJhZElucHV0c1J1bGVTZXQnLFxuICAgICAgICBwcmlvcml0eTogMixcbiAgICAgICAgb3ZlcnJpZGVBY3Rpb246IHsgbm9uZToge30gfSxcbiAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgbWFuYWdlZFJ1bGVHcm91cFN0YXRlbWVudDoge1xuICAgICAgICAgICAgdmVuZG9yTmFtZTogJ0FXUycsXG4gICAgICAgICAgICBuYW1lOiAnQVdTTWFuYWdlZFJ1bGVzS25vd25CYWRJbnB1dHNSdWxlU2V0JyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbWV0cmljTmFtZTogJ0FXU01hbmFnZWRSdWxlc0tub3duQmFkSW5wdXRzUnVsZVNldCcsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBuYW1lOiAnR2xvYmFsUmF0ZUxpbWl0JyxcbiAgICAgICAgcHJpb3JpdHk6IDMsXG4gICAgICAgIGFjdGlvbjogeyBibG9jazoge30gfSxcbiAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgcmF0ZUJhc2VkU3RhdGVtZW50OiB7XG4gICAgICAgICAgICBsaW1pdDogMjAwMCxcbiAgICAgICAgICAgIGFnZ3JlZ2F0ZUtleVR5cGU6ICdJUCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIG1ldHJpY05hbWU6ICdHbG9iYWxSYXRlTGltaXQnLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ090cFJhdGVMaW1pdCcsXG4gICAgICAgIHByaW9yaXR5OiA0LFxuICAgICAgICBhY3Rpb246IHsgYmxvY2s6IHt9IH0sXG4gICAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICAgIHJhdGVCYXNlZFN0YXRlbWVudDoge1xuICAgICAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgICAgICAgIGFnZ3JlZ2F0ZUtleVR5cGU6ICdJUCcsXG4gICAgICAgICAgICBzY29wZURvd25TdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgYnl0ZU1hdGNoU3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgICAgc2VhcmNoU3RyaW5nOiAnL3YxL290cC8nLFxuICAgICAgICAgICAgICAgIGZpZWxkVG9NYXRjaDogeyB1cmlQYXRoOiB7fSB9LFxuICAgICAgICAgICAgICAgIHRleHRUcmFuc2Zvcm1hdGlvbnM6IFt7IHByaW9yaXR5OiAwLCB0eXBlOiAnTk9ORScgfV0sXG4gICAgICAgICAgICAgICAgcG9zaXRpb25hbENvbnN0cmFpbnQ6ICdTVEFSVFNfV0lUSCcsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBtZXRyaWNOYW1lOiAnT3RwUmF0ZUxpbWl0JyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIG5hbWU6ICdQYXNza2V5UmF0ZUxpbWl0JyxcbiAgICAgICAgcHJpb3JpdHk6IDUsXG4gICAgICAgIGFjdGlvbjogeyBibG9jazoge30gfSxcbiAgICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgICAgcmF0ZUJhc2VkU3RhdGVtZW50OiB7XG4gICAgICAgICAgICBsaW1pdDogMTAwLFxuICAgICAgICAgICAgYWdncmVnYXRlS2V5VHlwZTogJ0lQJyxcbiAgICAgICAgICAgIHNjb3BlRG93blN0YXRlbWVudDoge1xuICAgICAgICAgICAgICBieXRlTWF0Y2hTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICAgICAgICBzZWFyY2hTdHJpbmc6ICcvdjEvcGFzc2tleXMvJyxcbiAgICAgICAgICAgICAgICBmaWVsZFRvTWF0Y2g6IHsgdXJpUGF0aDoge30gfSxcbiAgICAgICAgICAgICAgICB0ZXh0VHJhbnNmb3JtYXRpb25zOiBbeyBwcmlvcml0eTogMCwgdHlwZTogJ05PTkUnIH1dLFxuICAgICAgICAgICAgICAgIHBvc2l0aW9uYWxDb25zdHJhaW50OiAnU1RBUlRTX1dJVEgnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgICAgbWV0cmljTmFtZTogJ1Bhc3NrZXlSYXRlTGltaXQnLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICBdLFxuICB9KTtcblxuICBuZXcgd2FmdjIuQ2ZuV2ViQUNMQXNzb2NpYXRpb24oc3RhY2ssICdXYWZBbGJBc3NvY2lhdGlvbicsIHtcbiAgICB3ZWJBY2xBcm46IHdlYkFjbC5hdHRyQXJuLFxuICAgIHJlc291cmNlQXJuOiBhbGIubG9hZEJhbGFuY2VyQXJuLFxuICB9KTtcblxuICByZXR1cm4gd2ViQWNsO1xufVxuXG5mdW5jdGlvbiBhZGRDbG91ZEZyb250KFxuICBzdGFjazogY2RrLlN0YWNrLFxuICBhbGI6IGVsYXN0aWNsb2FkYmFsYW5jaW5ndjIuQXBwbGljYXRpb25Mb2FkQmFsYW5jZXIsXG4gIGNmZzogRW52Q29uZmlnLFxuKTogY2xvdWRmcm9udC5EaXN0cmlidXRpb24ge1xuICBjb25zdCBvcmlnaW4gPSBuZXcgb3JpZ2lucy5IdHRwT3JpZ2luKGFsYi5sb2FkQmFsYW5jZXJEbnNOYW1lLCB7XG4gICAgcHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUHJvdG9jb2xQb2xpY3kuSFRUUFNfT05MWSxcbiAgfSk7XG5cbiAgY29uc3QgaGFzQ2VydCA9IGNmZy5jbG91ZEZyb250Q2VydGlmaWNhdGVBcm4gIT09ICcnO1xuXG4gIGNvbnN0IGRpc3RQcm9wczogY2xvdWRmcm9udC5EaXN0cmlidXRpb25Qcm9wcyA9IHtcbiAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgIG9yaWdpbixcbiAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfQUxMLFxuICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19ESVNBQkxFRCxcbiAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdFBvbGljeS5BTExfVklFV0VSLFxuICAgIH0sXG4gICAgYWRkaXRpb25hbEJlaGF2aW9yczoge1xuICAgICAgJy8ud2VsbC1rbm93bi9qd2tzLmpzb24nOiB7XG4gICAgICAgIG9yaWdpbixcbiAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICBjYWNoZVBvbGljeTogbmV3IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3koc3RhY2ssICdKd2tzQ2FjaGVQb2xpY3knLCB7XG4gICAgICAgICAgZGVmYXVsdFR0bDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgbWF4VHRsOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgbWluVHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0sXG4gICAgaHR0cFZlcnNpb246IGNsb3VkZnJvbnQuSHR0cFZlcnNpb24uSFRUUDJfQU5EXzMsXG4gICAgLi4uKGhhc0NlcnQgJiYge1xuICAgICAgZG9tYWluTmFtZXM6IFtjZmcuZG9tYWluTmFtZV0sXG4gICAgICBjZXJ0aWZpY2F0ZTogYWNtLkNlcnRpZmljYXRlLmZyb21DZXJ0aWZpY2F0ZUFybihcbiAgICAgICAgc3RhY2ssXG4gICAgICAgICdDbG91ZEZyb250Q2VydGlmaWNhdGUnLFxuICAgICAgICBjZmcuY2xvdWRGcm9udENlcnRpZmljYXRlQXJuLFxuICAgICAgKSxcbiAgICB9KSxcbiAgfTtcblxuICBjb25zdCBkaXN0cmlidXRpb24gPSBuZXcgY2xvdWRmcm9udC5EaXN0cmlidXRpb24oc3RhY2ssICdEaXN0cmlidXRpb24nLCBkaXN0UHJvcHMpO1xuXG4gIG5ldyBjZGsuQ2ZuT3V0cHV0KHN0YWNrLCAnQ2xvdWRGcm9udERvbWFpbk5hbWUnLCB7XG4gICAgdmFsdWU6IGRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lLFxuICB9KTtcblxuICByZXR1cm4gZGlzdHJpYnV0aW9uO1xufVxuIl19