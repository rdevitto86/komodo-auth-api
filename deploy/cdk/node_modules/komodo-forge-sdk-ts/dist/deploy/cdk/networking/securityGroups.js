import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
export class SecurityGroupBuilder {
    props = {};
    ingressRules = [];
    egressRules = [];
    constructor(stack, vpc) {
        this.props.stack = stack;
        this.props.vpc = vpc;
    }
    setGroupName(name) {
        this.props.groupName = name;
        return this;
    }
    setDescription(description) {
        this.props.description = description;
        return this;
    }
    setAllowAllOutbound(allow) {
        this.props.allowAllOutbound = allow;
        return this;
    }
    setTags(tags) {
        this.props.tags = tags;
        return this;
    }
    addIngressRule(rule) {
        this.ingressRules.push(rule);
        return this;
    }
    addIngressRules(rules) {
        this.ingressRules.push(...rules);
        return this;
    }
    addEgressRule(rule) {
        this.egressRules.push(rule);
        return this;
    }
    addEgressRules(rules) {
        this.egressRules.push(...rules);
        return this;
    }
    build() {
        if (!this.props.stack || !this.props.vpc) {
            throw new Error('stack and vpc are required');
        }
        const securityGroup = new ec2.SecurityGroup(this.props.stack, this.props.groupName || 'SecurityGroup', {
            vpc: this.props.vpc,
            description: this.props.description || 'Security Group',
            allowAllOutbound: this.props.allowAllOutbound !== false,
        });
        if (this.props.tags) {
            Object.entries(this.props.tags).forEach(([key, value]) => {
                cdk.Tags.of(securityGroup).add(key, value);
            });
        }
        for (const rule of this.ingressRules) {
            securityGroup.addIngressRule(rule.peer, rule.connection, rule.description, rule.remoteRule);
        }
        for (const rule of this.egressRules) {
            securityGroup.addEgressRule(rule.peer, rule.connection, rule.description, rule.remoteRule);
        }
        return securityGroup;
    }
}
export const createSecurityGroup = (stack, vpc, props) => {
    const builder = new SecurityGroupBuilder(stack, vpc);
    if (props)
        Object.assign(builder['props'], props);
    return builder;
};
//# sourceMappingURL=securityGroups.js.map