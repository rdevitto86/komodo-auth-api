import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	createSecurityGroup,
	SecurityGroupBuilder,
	type SecurityGroupConfig,
	type SecurityGroupRule,
} from './securityGroups.js';
import { createVpc, VpcBuilder, type VpcProps } from './vpc.js';

describe('networking/vpc', () => {
	describe('VpcBuilder', () => {
		let mockStack: cdk.Stack;

		beforeEach(() => {
			mockStack = new cdk.Stack(undefined, 'TestStack', {
				env: {
					account: '123456789012',
					region: 'us-east-1',
				},
			});
		});

		it('should create builder with stack', () => {
			const builder = new VpcBuilder(mockStack);
			expect(builder).toBeInstanceOf(VpcBuilder);
		});

		it('should set id', () => {
			const builder = new VpcBuilder(mockStack);
			const result = builder.setId('test-vpc');
			expect(result).toBe(builder);
		});

		it('should set vpc id', () => {
			const builder = new VpcBuilder(mockStack);
			const result = builder.setVpcId('vpc-12345678');
			expect(result).toBe(builder);
		});

		it('should set max azs', () => {
			const builder = new VpcBuilder(mockStack);
			const result = builder.setMaxAzs(3);
			expect(result).toBe(builder);
		});

		it('should set nat gateways', () => {
			const builder = new VpcBuilder(mockStack);
			const result = builder.setNatGateways(2);
			expect(result).toBe(builder);
		});

		it('should set cidr', () => {
			const builder = new VpcBuilder(mockStack);
			const result = builder.setCidr('10.0.0.0/16');
			expect(result).toBe(builder);
		});

		it('should set enable dns hostnames', () => {
			const builder = new VpcBuilder(mockStack);
			const result = builder.setEnableDnsHostnames(true);
			expect(result).toBe(builder);
		});

		it('should set enable dns support', () => {
			const builder = new VpcBuilder(mockStack);
			const result = builder.setEnableDnsSupport(true);
			expect(result).toBe(builder);
		});

		it('should set vpn gateway', () => {
			const builder = new VpcBuilder(mockStack);
			const result = builder.setVpnGateway(true);
			expect(result).toBe(builder);
		});

		it('should set vpn route propagation', () => {
			const builder = new VpcBuilder(mockStack);
			const routes = [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }];
			const result = builder.setVpnRoutePropagation(routes);
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new VpcBuilder(mockStack);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should add subnet group', () => {
			const builder = new VpcBuilder(mockStack);
			const result = builder.addSubnetGroup({
				name: 'public',
				subnetType: ec2.SubnetType.PUBLIC,
				cidrMask: 24,
			});
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new VpcBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack is required');
		});

		it('should build vpc with defaults', () => {
			const builder = new VpcBuilder(mockStack);
			const vpc = builder.build();
			expect(vpc).toBeInstanceOf(ec2.Vpc);
		});

		it('should build vpc with custom values', () => {
			const builder = new VpcBuilder(mockStack)
				.setId('custom-vpc')
				.setMaxAzs(3)
				.setNatGateways(2)
				.setCidr('10.0.0.0/16')
				.setTags({ Environment: 'test' });
			const vpc = builder.build();
			expect(vpc).toBeInstanceOf(ec2.Vpc);
		});

		it('should build vpc from lookup when vpcId is set', () => {
			const builder = new VpcBuilder(mockStack).setId('lookup-vpc').setVpcId('vpc-12345678');
			const vpc = builder.build();
			expect(vpc).toBeDefined();
		});
	});

	describe('createVpc', () => {
		it('should create builder with stack', () => {
			const mockStack = new cdk.Stack();
			const builder = createVpc(mockStack);
			expect(builder).toBeInstanceOf(VpcBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const props: Partial<VpcProps> = {
				maxAzs: 3,
				cidr: '10.0.0.0/16',
			};
			const builder = createVpc(mockStack, props);
			expect(builder).toBeInstanceOf(VpcBuilder);
		});
	});
});

describe('networking/securityGroups', () => {
	describe('SecurityGroupBuilder', () => {
		let mockStack: cdk.Stack;
		let mockVpc: ec2.IVpc;

		beforeEach(() => {
			mockStack = new cdk.Stack(undefined, 'TestStack', {
				env: {
					account: '123456789012',
					region: 'us-east-1',
				},
			});
			mockVpc = new ec2.Vpc(mockStack, 'TestVpc');
		});

		it('should create builder with stack and vpc', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			expect(builder).toBeInstanceOf(SecurityGroupBuilder);
		});

		it('should set group name', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			const result = builder.setGroupName('test-sg');
			expect(result).toBe(builder);
		});

		it('should set description', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			const result = builder.setDescription('Test security group');
			expect(result).toBe(builder);
		});

		it('should set allow all outbound', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			const result = builder.setAllowAllOutbound(false);
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should add ingress rule', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			const rule: SecurityGroupRule = {
				peer: ec2.Peer.ipv4('10.0.0.0/16'),
				connection: ec2.Port.tcp(80),
			};
			const result = builder.addIngressRule(rule);
			expect(result).toBe(builder);
		});

		it('should add ingress rules', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			const rules: SecurityGroupRule[] = [
				{
					peer: ec2.Peer.ipv4('10.0.0.0/16'),
					connection: ec2.Port.tcp(80),
				},
				{
					peer: ec2.Peer.ipv4('10.0.0.0/16'),
					connection: ec2.Port.tcp(443),
				},
			];
			const result = builder.addIngressRules(rules);
			expect(result).toBe(builder);
		});

		it('should add egress rule', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			const rule: SecurityGroupRule = {
				peer: ec2.Peer.ipv4('0.0.0.0/0'),
				connection: ec2.Port.tcp(443),
			};
			const result = builder.addEgressRule(rule);
			expect(result).toBe(builder);
		});

		it('should add egress rules', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			const rules: SecurityGroupRule[] = [
				{
					peer: ec2.Peer.ipv4('0.0.0.0/0'),
					connection: ec2.Port.tcp(443),
				},
			];
			const result = builder.addEgressRules(rules);
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack and vpc are required');
		});

		it('should throw error when building without vpc', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			builder['props'].vpc = undefined as any;
			expect(() => builder.build()).toThrow('stack and vpc are required');
		});

		it('should build security group with defaults', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc);
			const sg = builder.build();
			expect(sg).toBeInstanceOf(ec2.SecurityGroup);
		});

		it('should build security group with custom values', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc)
				.setGroupName('custom-sg')
				.setDescription('Custom security group')
				.setAllowAllOutbound(false)
				.setTags({ Environment: 'test' });
			const sg = builder.build();
			expect(sg).toBeInstanceOf(ec2.SecurityGroup);
		});

		it('should build security group with ingress rules', () => {
			const builder = new SecurityGroupBuilder(mockStack, mockVpc).setGroupName('sg-with-rules').addIngressRule({
				peer: ec2.Peer.ipv4('10.0.0.0/16'),
				connection: ec2.Port.tcp(80),
				description: 'HTTP',
			});
			const sg = builder.build();
			expect(sg).toBeInstanceOf(ec2.SecurityGroup);
		});
	});

	describe('createSecurityGroup', () => {
		it('should create builder with stack and vpc', () => {
			const mockStack = new cdk.Stack();
			const mockVpc = new ec2.Vpc(mockStack, 'TestVpc');
			const builder = createSecurityGroup(mockStack, mockVpc);
			expect(builder).toBeInstanceOf(SecurityGroupBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const mockVpc = new ec2.Vpc(mockStack, 'TestVpc');
			const props: Partial<SecurityGroupConfig> = {
				groupName: 'test-sg',
				description: 'Test security group',
			};
			const builder = createSecurityGroup(mockStack, mockVpc, props);
			expect(builder).toBeInstanceOf(SecurityGroupBuilder);
		});
	});
});
