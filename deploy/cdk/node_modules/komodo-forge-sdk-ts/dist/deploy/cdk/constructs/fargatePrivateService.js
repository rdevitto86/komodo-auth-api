import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { buildFargateService } from './fargateServiceBase.js';
export class FargatePrivateService extends Construct {
    service;
    taskSecurityGroup;
    taskDefinition;
    constructor(scope, id, props) {
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
//# sourceMappingURL=fargatePrivateService.js.map