import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
export class FargateServiceBuilder {
    props = {};
    targetGroups = [];
    listeners = [];
    constructor(stack, vpc) {
        this.props.stack = stack;
        this.props.vpc = vpc;
    }
    setCluster(cluster) {
        this.props.cluster = cluster;
        return this;
    }
    setServiceName(name) {
        this.props.serviceName = name;
        return this;
    }
    setContainerName(name) {
        this.props.containerName = name;
        return this;
    }
    setImage(image) {
        this.props.image = image;
        return this;
    }
    setCpu(cpu) {
        this.props.cpu = cpu;
        return this;
    }
    setMemory(memoryLimitMiB) {
        this.props.memoryLimitMiB = memoryLimitMiB;
        return this;
    }
    setEnvironment(environment) {
        this.props.environment = environment;
        return this;
    }
    setSecrets(secrets) {
        this.props.secrets = secrets;
        return this;
    }
    setDesiredCount(count) {
        this.props.desiredCount = count;
        return this;
    }
    setHealthCheck(healthCheck) {
        this.props.healthCheck = healthCheck;
        return this;
    }
    setLogging(logging) {
        this.props.logging = logging;
        return this;
    }
    setTaskRole(role) {
        this.props.taskRole = role;
        return this;
    }
    setExecutionRole(role) {
        this.props.executionRole = role;
        return this;
    }
    setSecurityGroups(groups) {
        this.props.securityGroups = groups;
        return this;
    }
    setAssignPublicIp(assign) {
        this.props.assignPublicIp = assign;
        return this;
    }
    setEnableFargateCapacityProvider(enable) {
        this.props.enableFargateCapacityProvider = enable;
        return this;
    }
    setTags(tags) {
        this.props.tags = tags;
        return this;
    }
    addTargetGroup(targetGroup) {
        this.targetGroups.push(targetGroup);
        return this;
    }
    addListener(config) {
        this.listeners.push(config);
        return this;
    }
    build() {
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
            cluster: cluster,
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
export const createFargateService = (stack, vpc, props) => {
    const builder = new FargateServiceBuilder(stack, vpc);
    if (props)
        Object.assign(builder['props'], props);
    return builder;
};
//# sourceMappingURL=fargate.js.map