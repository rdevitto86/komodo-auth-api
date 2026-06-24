import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

import { buildFargateService } from './fargateServiceBase.js';

export interface FargatePublicServiceProps {
	vpc: ec2.IVpc;
	cluster: ecs.ICluster;
	logGroup: logs.ILogGroup;
	serviceName: string;
	image: ecs.ContainerImage;
	containerPort: number;
	environment?: Record<string, string>;
	healthCheckCommand?: string[];
	certificateArn: string;
	cpu?: number;
	memoryLimitMiB?: number;
	desiredCount?: number;
	minCapacity?: number;
	maxCapacity?: number;
	streamPrefix?: string;
	secretPath?: string;
}

export class FargatePublicService extends Construct {
	public readonly service: ecs.FargateService;
	public readonly alb: elbv2.ApplicationLoadBalancer;
	public readonly albSecurityGroup: ec2.SecurityGroup;
	public readonly taskSecurityGroup: ec2.SecurityGroup;
	public readonly taskDefinition: ecs.FargateTaskDefinition;

	constructor(scope: Construct, id: string, props: FargatePublicServiceProps) {
		super(scope, id);

		this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSG', {
			vpc: props.vpc,
			description: 'ALB ingress',
			allowAllOutbound: true,
		});
		this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
		this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));

		this.taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSG', {
			vpc: props.vpc,
			description: 'Fargate task',
			allowAllOutbound: true,
		});
		this.taskSecurityGroup.addIngressRule(this.albSecurityGroup, ec2.Port.tcp(props.containerPort));

		const { taskDefinition, service } = buildFargateService(this, {
			...props,
			streamPrefix: props.streamPrefix ?? 'public',
			securityGroups: [this.taskSecurityGroup],
		});
		this.taskDefinition = taskDefinition;
		this.service = service;

		this.alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
			vpc: props.vpc,
			internetFacing: true,
			securityGroup: this.albSecurityGroup,
		});

		this.alb.addListener('HttpListener', {
			port: 80,
			protocol: elbv2.ApplicationProtocol.HTTP,
			defaultAction: elbv2.ListenerAction.redirect({
				protocol: 'HTTPS',
				port: '443',
				permanent: true,
			}),
		});

		const cert = acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn);

		const httpsListener = this.alb.addListener('HttpsListener', {
			port: 443,
			protocol: elbv2.ApplicationProtocol.HTTPS,
			sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
			certificates: [cert],
		});

		httpsListener.addTargets('Target', {
			port: props.containerPort,
			protocol: elbv2.ApplicationProtocol.HTTP,
			targets: [
				this.service.loadBalancerTarget({
					containerName: props.serviceName,
					containerPort: props.containerPort,
				}),
			],
			healthCheck: {
				path: '/health',
				port: String(props.containerPort),
				interval: cdk.Duration.seconds(30),
				timeout: cdk.Duration.seconds(5),
			},
		});

		const unhealthyMetric = new cloudwatch.Metric({
			metricName: 'UnHealthyHostCount',
			namespace: 'AWS/ApplicationELB',
			dimensionsMap: { LoadBalancer: this.alb.loadBalancerArn },
			statistic: 'Average',
			period: cdk.Duration.seconds(60),
		});

		new cloudwatch.Alarm(this, 'UnhealthyTargetsAlarm', {
			metric: unhealthyMetric,
			threshold: 1,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
		});

		const errorMetric = new cloudwatch.Metric({
			metricName: 'HTTPCode_Target_5XX',
			namespace: 'AWS/ApplicationELB',
			dimensionsMap: { LoadBalancer: this.alb.loadBalancerArn },
			statistic: 'Sum',
			period: cdk.Duration.seconds(60),
		});

		new cloudwatch.Alarm(this, 'High5xxErrorAlarm', {
			metric: errorMetric,
			threshold: 5,
			evaluationPeriods: 2,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
		});
	}
}
