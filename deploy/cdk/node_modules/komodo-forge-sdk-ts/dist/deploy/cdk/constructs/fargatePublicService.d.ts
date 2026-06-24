import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
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
export declare class FargatePublicService extends Construct {
    readonly service: ecs.FargateService;
    readonly alb: elbv2.ApplicationLoadBalancer;
    readonly albSecurityGroup: ec2.SecurityGroup;
    readonly taskSecurityGroup: ec2.SecurityGroup;
    readonly taskDefinition: ecs.FargateTaskDefinition;
    constructor(scope: Construct, id: string, props: FargatePublicServiceProps);
}
//# sourceMappingURL=fargatePublicService.d.ts.map