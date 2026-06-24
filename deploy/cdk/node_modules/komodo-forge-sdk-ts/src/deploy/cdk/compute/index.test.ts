import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFargateService, FargateServiceBuilder, type FargateServiceProps } from './fargate.js';
import { createLambdaFunction, LambdaFunctionBuilder, type LambdaFunctionProps } from './lambda.js';

describe('compute/fargate', () => {
	describe('FargateServiceBuilder', () => {
		let mockStack: cdk.Stack;
		let mockVpc: ec2.IVpc;

		beforeEach(() => {
			mockStack = new cdk.Stack();
			mockVpc = new ec2.Vpc(mockStack, 'TestVpc');
		});

		it('should create builder with stack and vpc', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			expect(builder).toBeInstanceOf(FargateServiceBuilder);
		});

		it('should set cluster', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const cluster = new ecs.Cluster(mockStack, 'TestCluster', { vpc: mockVpc });
			const result = builder.setCluster(cluster);
			expect(result).toBe(builder);
		});

		it('should set service name', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const result = builder.setServiceName('test-service');
			expect(result).toBe(builder);
		});

		it('should set container name', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const result = builder.setContainerName('test-container');
			expect(result).toBe(builder);
		});

		it('should set image', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const image = ecs.ContainerImage.fromRegistry('nginx');
			const result = builder.setImage(image);
			expect(result).toBe(builder);
		});

		it('should set cpu', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const result = builder.setCpu(512);
			expect(result).toBe(builder);
		});

		it('should set memory', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const result = builder.setMemory(1024);
			expect(result).toBe(builder);
		});

		it('should set environment', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const env = { KEY: 'value' };
			const result = builder.setEnvironment(env);
			expect(result).toBe(builder);
		});

		it('should set secrets', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const secret = new secretsmanager.Secret(mockStack, 'TestSecret');
			const secrets = { SECRET: ecs.Secret.fromSecretsManager(secret) };
			const result = builder.setSecrets(secrets);
			expect(result).toBe(builder);
		});

		it('should set desired count', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const result = builder.setDesiredCount(3);
			expect(result).toBe(builder);
		});

		it('should set health check', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const healthCheck: ecs.HealthCheck = {
				command: ['CMD-SHELL', 'curl -f http://localhost/ || exit 1'],
				interval: cdk.Duration.seconds(30),
				timeout: cdk.Duration.seconds(5),
				retries: 3,
				startPeriod: cdk.Duration.seconds(60),
			};
			const result = builder.setHealthCheck(healthCheck);
			expect(result).toBe(builder);
		});

		it('should set logging', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const logging: ecs.AwsLogDriverProps = {
				streamPrefix: 'test',
			};
			const result = builder.setLogging(logging);
			expect(result).toBe(builder);
		});

		it('should set task role', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const role = new iam.Role(mockStack, 'TestRole', {
				assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
			});
			const result = builder.setTaskRole(role);
			expect(result).toBe(builder);
		});

		it('should set execution role', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const role = new iam.Role(mockStack, 'TestExecRole', {
				assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
			});
			const result = builder.setExecutionRole(role);
			expect(result).toBe(builder);
		});

		it('should set security groups', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const sg = new ec2.SecurityGroup(mockStack, 'TestSG', { vpc: mockVpc });
			const result = builder.setSecurityGroups([sg]);
			expect(result).toBe(builder);
		});

		it('should set assign public ip', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const result = builder.setAssignPublicIp(true);
			expect(result).toBe(builder);
		});

		it('should set enable fargate capacity provider', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const result = builder.setEnableFargateCapacityProvider(true);
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack and vpc are required');
		});

		it('should throw error when building without vpc', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			builder['props'].vpc = undefined as any;
			expect(() => builder.build()).toThrow('stack and vpc are required');
		});

		it('should build fargate service with defaults', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc);
			const service = builder.build();
			expect(service).toBeInstanceOf(ecs.FargateService);
		});

		it('should build fargate service with custom values', () => {
			const builder = new FargateServiceBuilder(mockStack, mockVpc)
				.setServiceName('custom-service')
				.setContainerName('custom-container')
				.setCpu(512)
				.setMemory(1024)
				.setDesiredCount(2)
				.setTags({ Environment: 'test' });
			const service = builder.build();
			expect(service).toBeInstanceOf(ecs.FargateService);
		});
	});

	describe('createFargateService', () => {
		it('should create builder with stack and vpc', () => {
			const mockStack = new cdk.Stack();
			const mockVpc = new ec2.Vpc(mockStack, 'TestVpc');
			const builder = createFargateService(mockStack, mockVpc);
			expect(builder).toBeInstanceOf(FargateServiceBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const mockVpc = new ec2.Vpc(mockStack, 'TestVpc');
			const props: Partial<FargateServiceProps> = {
				serviceName: 'test-service',
				cpu: 512,
				memoryLimitMiB: 1024,
			};
			const builder = createFargateService(mockStack, mockVpc, props);
			expect(builder).toBeInstanceOf(FargateServiceBuilder);
		});
	});
});

describe('compute/lambda', () => {
	describe('LambdaFunctionBuilder', () => {
		let mockStack: cdk.Stack;

		beforeEach(() => {
			mockStack = new cdk.Stack();
		});

		it('should create builder with stack', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			expect(builder).toBeInstanceOf(LambdaFunctionBuilder);
		});

		it('should set function name', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setFunctionName('test-function');
			expect(result).toBe(builder);
		});

		it('should set description', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setDescription('Test description');
			expect(result).toBe(builder);
		});

		it('should set runtime', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setRuntime(lambda.Runtime.NODEJS_20_X);
			expect(result).toBe(builder);
		});

		it('should set handler', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setHandler('index.handler');
			expect(result).toBe(builder);
		});

		it('should set code', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const code = lambda.Code.fromAsset('lambda');
			const result = builder.setCode(code);
			expect(result).toBe(builder);
		});

		it('should set environment', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const env = { KEY: 'value' };
			const result = builder.setEnvironment(env);
			expect(result).toBe(builder);
		});

		it('should set layers', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const layers: lambda.ILayerVersion[] = [];
			const result = builder.setLayers(layers);
			expect(result).toBe(builder);
		});

		it('should set memory size', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setMemorySize(256);
			expect(result).toBe(builder);
		});

		it('should set timeout', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setTimeout(cdk.Duration.seconds(60));
			expect(result).toBe(builder);
		});

		it('should set reserved concurrent executions', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setReservedConcurrentExecutions(10);
			expect(result).toBe(builder);
		});

		it('should set role', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const role = new iam.Role(mockStack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
			const result = builder.setRole(role);
			expect(result).toBe(builder);
		});

		it('should set log retention', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setLogRetention(logs.RetentionDays.ONE_MONTH);
			expect(result).toBe(builder);
		});

		it('should set log group', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const logGroup = new logs.LogGroup(mockStack, 'TestLogGroup');
			const result = builder.setLogGroup(logGroup);
			expect(result).toBe(builder);
		});

		it('should set tracing', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setTracing(lambda.Tracing.ACTIVE);
			expect(result).toBe(builder);
		});

		it('should set dead letter queue enabled', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const result = builder.setDeadLetterQueueEnabled(true);
			expect(result).toBe(builder);
		});

		it('should set dead letter queue', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const queue = {} as any; // Mock queue
			const result = builder.setDeadLetterQueue(queue);
			expect(result).toBe(builder);
		});

		it('should add permissions', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const permissions = [new iam.PolicyStatement()];
			const result = builder.addPermissions(permissions);
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should add event source', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const rule = new events.Rule(mockStack, 'TestRule');
			const result = builder.addEventSource(rule);
			expect(result).toBe(builder);
		});

		it('should add api gateway integration', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const api = new apigateway.RestApi(mockStack, 'TestApi');
			const result = builder.addApiGatewayIntegration({
				api,
				method: 'GET',
				path: 'test',
			});
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack is required');
		});

		it('should build lambda function with defaults', () => {
			const builder = new LambdaFunctionBuilder(mockStack);
			const fn = builder.build();
			expect(fn).toBeInstanceOf(lambda.Function);
		});

		it('should build lambda function with custom values', () => {
			const builder = new LambdaFunctionBuilder(mockStack)
				.setFunctionName('custom-function')
				.setDescription('Custom description')
				.setRuntime(lambda.Runtime.NODEJS_20_X)
				.setHandler('custom.handler')
				.setMemorySize(256)
				.setTimeout(cdk.Duration.seconds(60))
				.setTags({ Environment: 'test' });
			const fn = builder.build();
			expect(fn).toBeInstanceOf(lambda.Function);
		});
	});

	describe('createLambdaFunction', () => {
		it('should create builder with stack', () => {
			const mockStack = new cdk.Stack();
			const builder = createLambdaFunction(mockStack);
			expect(builder).toBeInstanceOf(LambdaFunctionBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const props: Partial<LambdaFunctionProps> = {
				functionName: 'test-function',
				memorySize: 256,
			};
			const builder = createLambdaFunction(mockStack, props);
			expect(builder).toBeInstanceOf(LambdaFunctionBuilder);
		});
	});
});
