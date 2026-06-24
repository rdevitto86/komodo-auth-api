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

export class SecurityGroupBuilder {
	private props: Partial<SecurityGroupConfig> = {};
	private ingressRules: SecurityGroupRule[] = [];
	private egressRules: SecurityGroupRule[] = [];

	constructor(stack: cdk.Stack, vpc: ec2.IVpc) {
		this.props.stack = stack;
		this.props.vpc = vpc;
	}

	setGroupName(name: string): this {
		this.props.groupName = name;
		return this;
	}

	setDescription(description: string): this {
		this.props.description = description;
		return this;
	}

	setAllowAllOutbound(allow: boolean): this {
		this.props.allowAllOutbound = allow;
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	addIngressRule(rule: SecurityGroupRule): this {
		this.ingressRules.push(rule);
		return this;
	}

	addIngressRules(rules: SecurityGroupRule[]): this {
		this.ingressRules.push(...rules);
		return this;
	}

	addEgressRule(rule: SecurityGroupRule): this {
		this.egressRules.push(rule);
		return this;
	}

	addEgressRules(rules: SecurityGroupRule[]): this {
		this.egressRules.push(...rules);
		return this;
	}

	build(): ec2.SecurityGroup {
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

export const createSecurityGroup = (
	stack: cdk.Stack,
	vpc: ec2.IVpc,
	props?: Partial<SecurityGroupConfig>,
): SecurityGroupBuilder => {
	const builder = new SecurityGroupBuilder(stack, vpc);
	if (props) Object.assign(builder['props'], props);
	return builder;
};
