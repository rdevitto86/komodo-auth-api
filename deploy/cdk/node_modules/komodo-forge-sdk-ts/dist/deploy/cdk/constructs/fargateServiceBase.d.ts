import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
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
export declare function buildFargateService(scope: Construct, props: FargateServiceBaseProps): FargateServiceResult;
//# sourceMappingURL=fargateServiceBase.d.ts.map