import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
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
export declare class FargatePrivateService extends Construct {
    readonly service: ecs.FargateService;
    readonly taskSecurityGroup: ec2.SecurityGroup;
    readonly taskDefinition: ecs.FargateTaskDefinition;
    constructor(scope: Construct, id: string, props: FargatePrivateServiceProps);
}
//# sourceMappingURL=fargatePrivateService.d.ts.map