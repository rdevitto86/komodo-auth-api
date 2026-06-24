import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
export interface SecurityGroupConfig {
    stack: cdk.Stack;
    vpc: ec2.IVpc;
    groupName?: string;
    description?: string;
    allowAllOutbound?: boolean;
    tags?: Record<string, string>;
}
export interface SecurityGroupRule {
    peer: ec2.IPeer;
    connection: ec2.Port;
    description?: string;
    remoteRule?: boolean;
}
export declare class SecurityGroupBuilder {
    private props;
    private ingressRules;
    private egressRules;
    constructor(stack: cdk.Stack, vpc: ec2.IVpc);
    setGroupName(name: string): this;
    setDescription(description: string): this;
    setAllowAllOutbound(allow: boolean): this;
    setTags(tags: Record<string, string>): this;
    addIngressRule(rule: SecurityGroupRule): this;
    addIngressRules(rules: SecurityGroupRule[]): this;
    addEgressRule(rule: SecurityGroupRule): this;
    addEgressRules(rules: SecurityGroupRule[]): this;
    build(): ec2.SecurityGroup;
}
export declare const createSecurityGroup: (stack: cdk.Stack, vpc: ec2.IVpc, props?: Partial<SecurityGroupConfig>) => SecurityGroupBuilder;
//# sourceMappingURL=securityGroups.d.ts.map