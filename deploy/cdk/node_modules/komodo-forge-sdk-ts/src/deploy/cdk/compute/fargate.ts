import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface FargateServiceProps {
	stack: cdk.Stack;
	vpc: ec2.IVpc;
	cluster?: ecs.ICluster;
	serviceName?: string;
	containerName?: string;
	image?: ecs.ContainerImage;
	cpu?: number;
	memoryLimitMiB?: number;
	environment?: Record<string, string>;
	secrets?: Record<string, ecs.Secret>;
	desiredCount?: number;
	healthCheck?: ecs.HealthCheck;
	logging?: ecs.AwsLogDriverProps;
	taskRole?: iam.Role;
	executionRole?: iam.Role;
	securityGroups?: ec2.ISecurityGroup[];
	assignPublicIp?: boolean;
	enableFargateCapacityProvider?: boolean;
	tags?: Record<string, string>;
}

export class FargateServiceBuilder {
	private props: Partial<FargateServiceProps> = {};
	private targetGroups: elbv2.ApplicationTargetGroup[] = [];
	private listeners: Array<{
		port: number;
		targetGroup: elbv2.ApplicationTargetGroup;
		protocol?: elbv2.ApplicationProtocol;
		healthCheck?: elbv2.HealthCheck;
		sslPolicy?: elbv2.SslPolicy;
		certificates?: elbv2.ListenerCertificate[];
	}> = [];

	constructor(stack: cdk.Stack, vpc: ec2.IVpc) {
		this.props.stack = stack;
		this.props.vpc = vpc;
	}

	setCluster(cluster: ecs.ICluster): this {
		this.props.cluster = cluster;
		return this;
	}

	setServiceName(name: string): this {
		this.props.serviceName = name;
		return this;
	}

	setContainerName(name: string): this {
		this.props.containerName = name;
		return this;
	}

	setImage(image: ecs.ContainerImage): this {
		this.props.image = image;
		return this;
	}

	setCpu(cpu: number): this {
		this.props.cpu = cpu;
		return this;
	}

	setMemory(memoryLimitMiB: number): this {
		this.props.memoryLimitMiB = memoryLimitMiB;
		return this;
	}

	setEnvironment(environment: Record<string, string>): this {
		this.props.environment = environment;
		return this;
	}

	setSecrets(secrets: Record<string, ecs.Secret>): this {
		this.props.secrets = secrets;
		return this;
	}

	setDesiredCount(count: number): this {
		this.props.desiredCount = count;
		return this;
	}

	setHealthCheck(healthCheck: ecs.HealthCheck): this {
		this.props.healthCheck = healthCheck;
		return this;
	}

	setLogging(logging: ecs.AwsLogDriverProps): this {
		this.props.logging = logging;
		return this;
	}

	setTaskRole(role: iam.Role): this {
		this.props.taskRole = role;
		return this;
	}

	setExecutionRole(role: iam.Role): this {
		this.props.executionRole = role;
		return this;
	}

	setSecurityGroups(groups: ec2.ISecurityGroup[]): this {
		this.props.securityGroups = groups;
		return this;
	}

	setAssignPublicIp(assign: boolean): this {
		this.props.assignPublicIp = assign;
		return this;
	}

	setEnableFargateCapacityProvider(enable: boolean): this {
		this.props.enableFargateCapacityProvider = enable;
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	addTargetGroup(targetGroup: elbv2.ApplicationTargetGroup): this {
		this.targetGroups.push(targetGroup);
		return this;
	}

	addListener(config: {
		port: number;
		targetGroup: elbv2.ApplicationTargetGroup;
		protocol?: elbv2.ApplicationProtocol;
		healthCheck?: elbv2.HealthCheck;
		sslPolicy?: elbv2.SslPolicy;
		certificates?: elbv2.ListenerCertificate[];
	}): this {
		this.listeners.push(config);
		return this;
	}

	build(): ecs.FargateService {
		if (!this.props.stack || !this.props.vpc) {
			throw new Error('stack and vpc are required');
		}

		const stack = this.props.stack;
		const taskDefinition = new ecs.FargateTaskDefinition(stack, 'FargateTaskDef', {
			cpu: this.props.cpu || 256,
			memoryLimitMiB: this.props.memoryLimitMiB || 512,
			...(this.props.taskRole && { taskRole: this.props.taskRole }),
			...(this.props.executionRole && { executionRole: this.props.executionRole }),
		});

		const containerName = this.props.containerName || 'app';
		taskDefinition.addContainer(containerName, {
			image: this.props.image || ecs.ContainerImage.fromRegistry('nginx'),
			...(this.props.healthCheck && { healthCheck: this.props.healthCheck }),
			...(this.props.environment && { environment: this.props.environment }),
			...(this.props.secrets && { secrets: this.props.secrets }),
			...(this.props.logging && { logging: new ecs.AwsLogDriver(this.props.logging) }),
		});

		const cluster = this.props.cluster || new ecs.Cluster(stack, 'FargateCluster', { vpc: this.props.vpc });
		const service = new ecs.FargateService(stack, this.props.serviceName || 'FargateService', {
			cluster: cluster as ecs.ICluster,
			taskDefinition,
			desiredCount: this.props.desiredCount || 1,
			...(this.props.securityGroups && { securityGroups: this.props.securityGroups }),
			...(this.props.assignPublicIp !== undefined && { assignPublicIp: this.props.assignPublicIp }),
		});

		if (this.props.tags) {
			Object.entries(this.props.tags).forEach(([key, value]) => {
				cdk.Tags.of(service).add(key, value);
			});
		}

		for (const targetGroup of this.targetGroups) {
			targetGroup.addTarget(service);
		}
		return service;
	}
}

export const createFargateService = (
	stack: cdk.Stack,
	vpc: ec2.IVpc,
	props?: Partial<FargateServiceProps>,
): FargateServiceBuilder => {
	const builder = new FargateServiceBuilder(stack, vpc);
	if (props) Object.assign(builder['props'], props);
	return builder;
};
