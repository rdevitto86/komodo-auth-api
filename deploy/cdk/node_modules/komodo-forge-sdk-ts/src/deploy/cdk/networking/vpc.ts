import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface VpcProps {
	stack: cdk.Stack;
	id?: string;
	vpcId?: string;
	maxAzs?: number;
	natGateways?: number;
	subnetConfiguration?: ec2.SubnetConfiguration[];
	cidr?: string;
	enableDnsHostnames?: boolean;
	enableDnsSupport?: boolean;
	vpnGateway?: boolean;
	vpnRoutePropagation?: ec2.SubnetSelection[];
	tags?: Record<string, string>;
}

export class VpcBuilder {
	private props: Partial<VpcProps> = {};
	private subnetGroups: ec2.SubnetConfiguration[] = [];

	constructor(stack: cdk.Stack) {
		this.props.stack = stack;
	}

	setId(id: string): this {
		this.props.id = id;
		return this;
	}

	setVpcId(vpcId: string): this {
		this.props.vpcId = vpcId;
		return this;
	}

	setMaxAzs(maxAzs: number): this {
		this.props.maxAzs = maxAzs;
		return this;
	}

	setNatGateways(count: number): this {
		this.props.natGateways = count;
		return this;
	}

	setCidr(cidr: string): this {
		this.props.cidr = cidr;
		return this;
	}

	setEnableDnsHostnames(enabled: boolean): this {
		this.props.enableDnsHostnames = enabled;
		return this;
	}

	setEnableDnsSupport(enabled: boolean): this {
		this.props.enableDnsSupport = enabled;
		return this;
	}

	setVpnGateway(enabled: boolean): this {
		this.props.vpnGateway = enabled;
		return this;
	}

	setVpnRoutePropagation(routes: ec2.SubnetSelection[]): this {
		this.props.vpnRoutePropagation = routes;
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	addSubnetGroup(config: { name: string; subnetType: ec2.SubnetType; cidrMask?: number }): this {
		this.subnetGroups.push({
			name: config.name,
			subnetType: config.subnetType,
			...(config.cidrMask && { cidrMask: config.cidrMask }),
		});
		return this;
	}

	build(): ec2.Vpc {
		if (!this.props.stack) {
			throw new Error('stack is required');
		}

		const stack = this.props.stack;

		if (this.props.vpcId) {
			const vpc = ec2.Vpc.fromLookup(stack, this.props.id || 'Vpc', {
				vpcId: this.props.vpcId,
			});
			return vpc as ec2.Vpc;
		}

		const vpcProps: ec2.VpcProps = {
			maxAzs: this.props.maxAzs || 2,
			natGateways: this.props.natGateways || 1,
			...(this.subnetGroups.length > 0 && { subnetConfiguration: this.subnetGroups }),
			...(this.props.cidr && { cidr: this.props.cidr }),
			...(this.props.enableDnsHostnames !== undefined && { enableDnsHostnames: this.props.enableDnsHostnames }),
			...(this.props.enableDnsSupport !== undefined && { enableDnsSupport: this.props.enableDnsSupport }),
			...(this.props.vpnGateway && { vpnGateway: true }),
			...(this.props.vpnRoutePropagation && { vpnRoutePropagation: this.props.vpnRoutePropagation }),
		};

		const vpc = new ec2.Vpc(stack, this.props.id || 'Vpc', vpcProps);

		if (this.props.tags) {
			Object.entries(this.props.tags).forEach(([key, value]) => {
				cdk.Tags.of(vpc).add(key, value);
			});
		}
		return vpc;
	}
}

export const createVpc = (stack: cdk.Stack, props?: Partial<VpcProps>): VpcBuilder => {
	const builder = new VpcBuilder(stack);
	if (props) Object.assign(builder['props'], props);
	return builder;
};
