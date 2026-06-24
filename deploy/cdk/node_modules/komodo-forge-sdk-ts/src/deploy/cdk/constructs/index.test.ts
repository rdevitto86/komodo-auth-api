import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { beforeEach, describe, expect, it } from 'vitest';
import { FargatePrivateService, type FargatePrivateServiceProps } from './fargatePrivateService.js';
import { FargatePublicService, type FargatePublicServiceProps } from './fargatePublicService.js';
import { MetricFilterAlarm } from './metricFilterAlarm.js';
import { WafWebAcl } from './wafWebAcl.js';

// ── Unit Tests: FargatePublicService ────────────────────────────────────

describe('constructs/FargatePublicService', () => {
	let stack: cdk.Stack;
	let vpc: ec2.Vpc;
	let cluster: ecs.Cluster;
	let logGroup: logs.LogGroup;
	let baseProps: FargatePublicServiceProps;

	beforeEach(() => {
		stack = new cdk.Stack();
		vpc = new ec2.Vpc(stack, 'Vpc');
		cluster = new ecs.Cluster(stack, 'Cluster', { vpc });
		logGroup = new logs.LogGroup(stack, 'LogGroup');
		baseProps = {
			vpc,
			cluster,
			logGroup,
			serviceName: 'test-public-svc',
			image: ecs.ContainerImage.fromRegistry('nginx'),
			containerPort: 8080,
			certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc-123',
		};
	});

	it('creates a Fargate task definition with default CPU/memory', () => {
		new FargatePublicService(stack, 'Pub', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ECS::TaskDefinition', {
			Cpu: '256',
			Memory: '512',
		});
	});

	it('creates a Fargate task definition with custom CPU/memory', () => {
		new FargatePublicService(stack, 'Pub', { ...baseProps, cpu: 1024, memoryLimitMiB: 2048 });
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ECS::TaskDefinition', {
			Cpu: '1024',
			Memory: '2048',
		});
	});

	it('creates a container with serviceName, port mappings, health check, and logging', () => {
		new FargatePublicService(stack, 'Pub', {
			...baseProps,
			environment: { NODE_ENV: 'production' },
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ECS::TaskDefinition', {
			ContainerDefinitions: Match.arrayWith([
				Match.objectLike({
					Name: 'test-public-svc',
					Essential: true,
					PortMappings: [{ ContainerPort: 8080, Protocol: 'tcp' }],
					HealthCheck: Match.objectLike({
						Command: ['CMD-SHELL', 'exit 0'],
					}),
					Environment: Match.arrayWith([{ Name: 'NODE_ENV', Value: 'production' }]),
					LogConfiguration: Match.objectLike({
						LogDriver: 'awslogs',
					}),
				}),
			]),
		});
	});

	it('creates ALB security group with port 80 and 443 ingress', () => {
		new FargatePublicService(stack, 'Pub', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::EC2::SecurityGroup', {
			GroupDescription: 'ALB ingress',
			SecurityGroupIngress: Match.arrayWith([
				Match.objectLike({
					CidrIp: '0.0.0.0/0',
					FromPort: 80,
					ToPort: 80,
					IpProtocol: 'tcp',
				}),
				Match.objectLike({
					CidrIp: '0.0.0.0/0',
					FromPort: 443,
					ToPort: 443,
					IpProtocol: 'tcp',
				}),
			]),
		});
	});

	it('creates task security group with container port ingress from ALB SG', () => {
		new FargatePublicService(stack, 'Pub', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::EC2::SecurityGroup', {
			GroupDescription: 'Fargate task',
		});
		template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
			IpProtocol: 'tcp',
			FromPort: 8080,
			ToPort: 8080,
		});
	});

	it('creates an internet-facing ALB', () => {
		new FargatePublicService(stack, 'Pub', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
			Scheme: 'internet-facing',
		});
	});

	it('creates HTTP to HTTPS redirect listener', () => {
		new FargatePublicService(stack, 'Pub', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
			Port: 80,
			Protocol: 'HTTP',
			DefaultActions: Match.arrayWith([
				Match.objectLike({
					Type: 'redirect',
					RedirectConfig: Match.objectLike({
						Protocol: 'HTTPS',
						Port: '443',
						StatusCode: 'HTTP_301',
					}),
				}),
			]),
		});
	});

	it('creates HTTPS listener on port 443', () => {
		new FargatePublicService(stack, 'Pub', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
			Port: 443,
			Protocol: 'HTTPS',
		});
	});

	it('creates target group on containerPort with /health check', () => {
		new FargatePublicService(stack, 'Pub', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
			Port: 8080,
			Protocol: 'HTTP',
			HealthCheckPath: '/health',
			HealthCheckPort: '8080',
		});
	});

	it('creates Fargate service with correct serviceName and desiredCount', () => {
		new FargatePublicService(stack, 'Pub', { ...baseProps, desiredCount: 3 });
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ECS::Service', {
			ServiceName: 'test-public-svc',
			DesiredCount: 3,
		});
	});

	it('creates auto-scaling with min/max capacity', () => {
		new FargatePublicService(stack, 'Pub', { ...baseProps, minCapacity: 2, maxCapacity: 10 });
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
			MinCapacity: 2,
			MaxCapacity: 10,
		});
	});

	it('creates 4 CloudWatch alarms', () => {
		new FargatePublicService(stack, 'Pub', baseProps);
		const template = Template.fromStack(stack);
		const alarms = template.findResources('AWS::CloudWatch::Alarm');
		const alarmKeys = Object.keys(alarms);
		expect(alarmKeys.length).toBe(4);
	});

	it('grants secret read access when secretPath provided', () => {
		new FargatePublicService(stack, 'Pub', { ...baseProps, secretPath: 'my/secret' });
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::IAM::Policy', {
			PolicyDocument: Match.objectLike({
				Statement: Match.arrayWith([
					Match.objectLike({
						Action: Match.anyValue(),
						Effect: 'Allow',
					}),
				]),
			}),
		});
	});

	it('does not create secret resources when secretPath is omitted', () => {
		new FargatePublicService(stack, 'Pub', baseProps);
		const template = Template.fromStack(stack);
		const policies = template.findResources('AWS::IAM::Policy');
		const policyKeys = Object.keys(policies);
		for (const key of policyKeys) {
			const statements = policies[key]?.Properties?.PolicyDocument?.Statement as
				| Array<{ Action: string | string[] }>
				| undefined;
			if (statements) {
				for (const stmt of statements) {
					const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
					expect(actions.some((a: string) => a.includes('secretsmanager'))).toBe(false);
				}
			}
		}
	});
});

// ── Unit Tests: FargatePrivateService ───────────────────────────────────

describe('constructs/FargatePrivateService', () => {
	let stack: cdk.Stack;
	let vpc: ec2.Vpc;
	let cluster: ecs.Cluster;
	let logGroup: logs.LogGroup;
	let baseProps: FargatePrivateServiceProps;

	beforeEach(() => {
		stack = new cdk.Stack();
		vpc = new ec2.Vpc(stack, 'Vpc');
		cluster = new ecs.Cluster(stack, 'Cluster', { vpc });
		logGroup = new logs.LogGroup(stack, 'LogGroup');
		baseProps = {
			vpc,
			cluster,
			logGroup,
			serviceName: 'test-private-svc',
			image: ecs.ContainerImage.fromRegistry('nginx'),
			containerPort: 9090,
		};
	});

	it('creates task definition with correct CPU/memory', () => {
		new FargatePrivateService(stack, 'Priv', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ECS::TaskDefinition', {
			Cpu: '256',
			Memory: '512',
		});
	});

	it('creates task definition with custom CPU/memory', () => {
		new FargatePrivateService(stack, 'Priv', { ...baseProps, cpu: 512, memoryLimitMiB: 1024 });
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ECS::TaskDefinition', {
			Cpu: '512',
			Memory: '1024',
		});
	});

	it('creates container with serviceName, port, health check, environment, and logging', () => {
		new FargatePrivateService(stack, 'Priv', {
			...baseProps,
			environment: { APP_MODE: 'worker' },
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ECS::TaskDefinition', {
			ContainerDefinitions: Match.arrayWith([
				Match.objectLike({
					Name: 'test-private-svc',
					Essential: true,
					PortMappings: [{ ContainerPort: 9090, Protocol: 'tcp' }],
					HealthCheck: Match.objectLike({
						Command: ['CMD-SHELL', 'exit 0'],
					}),
					Environment: Match.arrayWith([{ Name: 'APP_MODE', Value: 'worker' }]),
					LogConfiguration: Match.objectLike({
						LogDriver: 'awslogs',
					}),
				}),
			]),
		});
	});

	it('creates task security group with VPC CIDR ingress on containerPort', () => {
		new FargatePrivateService(stack, 'Priv', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::EC2::SecurityGroup', {
			GroupDescription: 'Fargate task',
			SecurityGroupIngress: Match.arrayWith([
				Match.objectLike({
					FromPort: 9090,
					ToPort: 9090,
					IpProtocol: 'tcp',
				}),
			]),
		});
	});

	it('creates Fargate service', () => {
		new FargatePrivateService(stack, 'Priv', baseProps);
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ECS::Service', {
			ServiceName: 'test-private-svc',
		});
	});

	it('creates auto-scaling', () => {
		new FargatePrivateService(stack, 'Priv', { ...baseProps, minCapacity: 1, maxCapacity: 5 });
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
			MinCapacity: 1,
			MaxCapacity: 5,
		});
	});

	it('creates 2 alarms (CPU and memory)', () => {
		new FargatePrivateService(stack, 'Priv', baseProps);
		const template = Template.fromStack(stack);
		const alarms = template.findResources('AWS::CloudWatch::Alarm');
		expect(Object.keys(alarms).length).toBe(2);
	});

	it('does not create an ALB', () => {
		new FargatePrivateService(stack, 'Priv', baseProps);
		const template = Template.fromStack(stack);
		const albs = template.findResources('AWS::ElasticLoadBalancingV2::LoadBalancer');
		expect(Object.keys(albs).length).toBe(0);
	});

	it('grants secret read access when secretPath provided', () => {
		new FargatePrivateService(stack, 'Priv', { ...baseProps, secretPath: 'my/secret' });
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::IAM::Policy', {
			PolicyDocument: Match.objectLike({
				Statement: Match.arrayWith([
					Match.objectLike({
						Action: Match.anyValue(),
						Effect: 'Allow',
					}),
				]),
			}),
		});
	});
});

// ── Unit Tests: WafWebAcl ──────────────────────────────────────────────

describe('constructs/WafWebAcl', () => {
	let stack: cdk.Stack;

	beforeEach(() => {
		stack = new cdk.Stack();
	});

	it('creates WebACL with REGIONAL scope', () => {
		new WafWebAcl(stack, 'Waf', { metricPrefix: 'test' });
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::WAFv2::WebACL', {
			Scope: 'REGIONAL',
		});
	});

	it('adds managed rule groups with auto-incrementing priority', () => {
		new WafWebAcl(stack, 'Waf', {
			metricPrefix: 'test',
			managedRuleGroups: [{ name: 'AWSManagedRulesCommonRuleSet' }, { name: 'AWSManagedRulesSQLiRuleSet' }],
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::WAFv2::WebACL', {
			Rules: Match.arrayWith([
				Match.objectLike({
					Name: 'AWSManagedRulesCommonRuleSet',
					Priority: 1,
					Statement: {
						ManagedRuleGroupStatement: {
							VendorName: 'AWS',
							Name: 'AWSManagedRulesCommonRuleSet',
						},
					},
				}),
				Match.objectLike({
					Name: 'AWSManagedRulesSQLiRuleSet',
					Priority: 2,
					Statement: {
						ManagedRuleGroupStatement: {
							VendorName: 'AWS',
							Name: 'AWSManagedRulesSQLiRuleSet',
						},
					},
				}),
			]),
		});
	});

	it('adds global rate limit rule when globalRateLimit provided', () => {
		new WafWebAcl(stack, 'Waf', {
			metricPrefix: 'test',
			globalRateLimit: 2000,
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::WAFv2::WebACL', {
			Rules: Match.arrayWith([
				Match.objectLike({
					Name: 'GlobalRateLimit',
					Action: { Block: {} },
					Statement: {
						RateBasedStatement: {
							Limit: 2000,
							AggregateKeyType: 'IP',
						},
					},
				}),
			]),
		});
	});

	it('adds path-scoped rate limit rules', () => {
		new WafWebAcl(stack, 'Waf', {
			metricPrefix: 'test',
			rateLimitRules: [{ name: 'LoginLimit', limit: 100, pathPrefix: '/api/login' }],
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::WAFv2::WebACL', {
			Rules: Match.arrayWith([
				Match.objectLike({
					Name: 'LoginLimit',
					Action: { Block: {} },
					Statement: {
						RateBasedStatement: Match.objectLike({
							Limit: 100,
							AggregateKeyType: 'IP',
							ScopeDownStatement: {
								ByteMatchStatement: Match.objectLike({
									SearchString: '/api/login',
									PositionalConstraint: 'STARTS_WITH',
								}),
							},
						}),
					},
				}),
			]),
		});
	});

	it('associates with ALB when associateAlb provided', () => {
		const vpc = new ec2.Vpc(stack, 'Vpc');
		const alb = new cdk.aws_elasticloadbalancingv2.ApplicationLoadBalancer(stack, 'Alb', {
			vpc,
			internetFacing: true,
		});
		new WafWebAcl(stack, 'Waf', {
			metricPrefix: 'test',
			associateAlb: alb,
		});
		const template = Template.fromStack(stack);
		template.hasResource('AWS::WAFv2::WebACLAssociation', {});
	});

	it('does not create association when associateAlb omitted', () => {
		new WafWebAcl(stack, 'Waf', { metricPrefix: 'test' });
		const template = Template.fromStack(stack);
		const assocs = template.findResources('AWS::WAFv2::WebACLAssociation');
		expect(Object.keys(assocs).length).toBe(0);
	});

	it('rule count matches managed groups + global + rate limit rules', () => {
		new WafWebAcl(stack, 'Waf', {
			metricPrefix: 'test',
			managedRuleGroups: [{ name: 'AWSManagedRulesCommonRuleSet' }, { name: 'AWSManagedRulesSQLiRuleSet' }],
			globalRateLimit: 2000,
			rateLimitRules: [
				{ name: 'LoginLimit', limit: 100, pathPrefix: '/api/login' },
				{ name: 'SignupLimit', limit: 50, pathPrefix: '/api/signup' },
			],
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::WAFv2::WebACL', {
			Rules: Match.arrayWith([
				Match.objectLike({ Priority: 1 }),
				Match.objectLike({ Priority: 2 }),
				Match.objectLike({ Priority: 3 }),
				Match.objectLike({ Priority: 4 }),
				Match.objectLike({ Priority: 5 }),
			]),
		});
		const webAcls = template.findResources('AWS::WAFv2::WebACL');
		const aclKey = Object.keys(webAcls)[0]!;
		const rules = webAcls[aclKey]!.Properties.Rules as unknown[];
		expect(rules.length).toBe(5);
	});
});

// ── Unit Tests: MetricFilterAlarm ──────────────────────────────────────

describe('constructs/MetricFilterAlarm', () => {
	let stack: cdk.Stack;
	let logGroup: logs.LogGroup;

	beforeEach(() => {
		stack = new cdk.Stack();
		logGroup = new logs.LogGroup(stack, 'LogGroup');
	});

	it('creates a metric filter with correct namespace and metric name', () => {
		new MetricFilterAlarm(stack, 'MFA', {
			logGroup,
			filterPattern: '"ERROR"',
			metricNamespace: 'MyApp',
			metricName: 'ErrorCount',
			alarmName: 'ErrorAlarm',
			threshold: 5,
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: '"ERROR"',
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: 'MyApp',
					MetricName: 'ErrorCount',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});
	});

	it('creates an alarm with correct threshold and evaluation periods', () => {
		new MetricFilterAlarm(stack, 'MFA', {
			logGroup,
			filterPattern: '"ERROR"',
			metricNamespace: 'MyApp',
			metricName: 'ErrorCount',
			alarmName: 'ErrorAlarm',
			threshold: 5,
			evaluationPeriods: 3,
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::CloudWatch::Alarm', {
			AlarmName: 'ErrorAlarm',
			Threshold: 5,
			EvaluationPeriods: 3,
		});
	});

	it('uses default values when not specified', () => {
		new MetricFilterAlarm(stack, 'MFA', {
			logGroup,
			filterPattern: '"WARN"',
			metricNamespace: 'MyApp',
			metricName: 'WarnCount',
			alarmName: 'WarnAlarm',
			threshold: 10,
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::CloudWatch::Alarm', {
			EvaluationPeriods: 1,
			ComparisonOperator: 'GreaterThanThreshold',
			TreatMissingData: 'notBreaching',
			Period: 300,
			Statistic: 'Sum',
		});
	});

	it('uses custom values when provided', () => {
		new MetricFilterAlarm(stack, 'MFA', {
			logGroup,
			filterPattern: '"CRITICAL"',
			metricNamespace: 'MyApp',
			metricName: 'CriticalCount',
			alarmName: 'CriticalAlarm',
			threshold: 1,
			evaluationPeriods: 2,
			metricPeriod: cdk.Duration.minutes(1),
			metricStatistic: 'Average',
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.BREACHING,
		});
		const template = Template.fromStack(stack);
		template.hasResourceProperties('AWS::CloudWatch::Alarm', {
			Threshold: 1,
			EvaluationPeriods: 2,
			Period: 60,
			Statistic: 'Average',
			ComparisonOperator: 'GreaterThanOrEqualToThreshold',
			TreatMissingData: 'breaching',
		});
	});
});
