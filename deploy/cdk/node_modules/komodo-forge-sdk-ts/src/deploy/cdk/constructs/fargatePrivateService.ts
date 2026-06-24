import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

import { buildFargateService } from './fargateServiceBase.js';

export interface FargatePrivateServiceProps {
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
}

export class FargatePrivateService extends Construct {
	public readonly service: ecs.FargateService;
	public readonly taskSecurityGroup: ec2.SecurityGroup;
	public readonly taskDefinition: ecs.FargateTaskDefinition;

	constructor(scope: Construct, id: string, props: FargatePrivateServiceProps) {
		super(scope, id);

		this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSG', {
			vpc: props.vpc,
			description: 'Fargate task',
			allowAllOutbound: true,
		});
		this.taskSecurityGroup.addIngressRule(ec2.Peer.ipv4(props.vpc.vpcCidrBlock), ec2.Port.tcp(props.containerPort));

		const { taskDefinition, service } = buildFargateService(this, {
			...props,
			streamPrefix: props.streamPrefix ?? 'private',
			securityGroups: [this.taskSecurityGroup],
		});
		this.taskDefinition = taskDefinition;
		this.service = service;
	}
}
