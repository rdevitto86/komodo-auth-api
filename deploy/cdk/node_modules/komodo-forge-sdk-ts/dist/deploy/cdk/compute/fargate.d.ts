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
export declare class FargateServiceBuilder {
    private props;
    private targetGroups;
    private listeners;
    constructor(stack: cdk.Stack, vpc: ec2.IVpc);
    setCluster(cluster: ecs.ICluster): this;
    setServiceName(name: string): this;
    setContainerName(name: string): this;
    setImage(image: ecs.ContainerImage): this;
    setCpu(cpu: number): this;
    setMemory(memoryLimitMiB: number): this;
    setEnvironment(environment: Record<string, string>): this;
    setSecrets(secrets: Record<string, ecs.Secret>): this;
    setDesiredCount(count: number): this;
    setHealthCheck(healthCheck: ecs.HealthCheck): this;
    setLogging(logging: ecs.AwsLogDriverProps): this;
    setTaskRole(role: iam.Role): this;
    setExecutionRole(role: iam.Role): this;
    setSecurityGroups(groups: ec2.ISecurityGroup[]): this;
    setAssignPublicIp(assign: boolean): this;
    setEnableFargateCapacityProvider(enable: boolean): this;
    setTags(tags: Record<string, string>): this;
    addTargetGroup(targetGroup: elbv2.ApplicationTargetGroup): this;
    addListener(config: {
        port: number;
        targetGroup: elbv2.ApplicationTargetGroup;
        protocol?: elbv2.ApplicationProtocol;
        healthCheck?: elbv2.HealthCheck;
        sslPolicy?: elbv2.SslPolicy;
        certificates?: elbv2.ListenerCertificate[];
    }): this;
    build(): ecs.FargateService;
}
export declare const createFargateService: (stack: cdk.Stack, vpc: ec2.IVpc, props?: Partial<FargateServiceProps>) => FargateServiceBuilder;
//# sourceMappingURL=fargate.d.ts.map