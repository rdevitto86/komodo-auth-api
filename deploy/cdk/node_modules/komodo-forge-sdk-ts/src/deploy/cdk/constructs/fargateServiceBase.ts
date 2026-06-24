import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface FargateServiceBaseProps {
	vpc: ec2.IVpc;
	cluster: ecs.ICluster;
	logGroup: logs.ILogGroup;
	serviceName: string;
	image: ecs.ContainerImage;
	containerPort: number;
	environment?: Record<string, string>;
	healthCheckCommand?: string[];
	cpu?: number;
	memoryLimitMiB?: number;
	desiredCount?: number;
	minCapacity?: number;
	maxCapacity?: number;
	streamPrefix?: string;
	secretPath?: string;
	securityGroups: ec2.ISecurityGroup[];
}

export interface FargateServiceResult {
	taskDefinition: ecs.FargateTaskDefinition;
	service: ecs.FargateService;
}

export function buildFargateService(scope: Construct, props: FargateServiceBaseProps): FargateServiceResult {
	const cpu = props.cpu ?? 256;
	const memoryLimitMiB = props.memoryLimitMiB ?? 512;

	const taskDefinition = new ecs.FargateTaskDefinition(scope, 'TaskDef', {
		cpu,
		memoryLimitMiB,
	});

	if (props.secretPath) {
		const secret = secretsmanager.Secret.fromSecretNameV2(scope, 'Secret', props.secretPath);
		secret.grantRead(taskDefinition.taskRole);
	}

	taskDefinition.addContainer('container', {
		image: props.image,
		essential: true,
		containerName: props.serviceName,
		portMappings: [{ containerPort: props.containerPort, protocol: ecs.Protocol.TCP }],
		healthCheck: {
			command: props.healthCheckCommand ?? ['CMD-SHELL', 'exit 0'],
			interval: cdk.Duration.seconds(30),
			timeout: cdk.Duration.seconds(5),
			retries: 3,
			startPeriod: cdk.Duration.seconds(10),
		},
		...(props.environment && { environment: props.environment }),
		logging: ecs.LogDrivers.awsLogs({
			logGroup: props.logGroup,
			streamPrefix: props.streamPrefix ?? 'service',
		}),
	});

	const service = new ecs.FargateService(scope, 'Service', {
		cluster: props.cluster,
		taskDefinition,
		desiredCount: props.desiredCount ?? 1,
		securityGroups: props.securityGroups,
		assignPublicIp: false,
		serviceName: props.serviceName,
	});

	const scaling = service.autoScaleTaskCount({
		minCapacity: props.minCapacity ?? 1,
		maxCapacity: props.maxCapacity ?? 2,
	});
	scaling.scaleOnCpuUtilization('CpuScaling', {
		targetUtilizationPercent: 70,
	});

	new cloudwatch.Alarm(scope, 'CpuHighAlarm', {
		metric: service.metricCpuUtilization(),
		threshold: 80,
		evaluationPeriods: 3,
		comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
	});

	new cloudwatch.Alarm(scope, 'MemoryHighAlarm', {
		metric: service.metricMemoryUtilization(),
		threshold: 80,
		evaluationPeriods: 3,
		comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
	});

	return { taskDefinition, service };
}
