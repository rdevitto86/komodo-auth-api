import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
export class VpcBuilder {
    props = {};
    subnetGroups = [];
    constructor(stack) {
        this.props.stack = stack;
    }
    setId(id) {
        this.props.id = id;
        return this;
    }
    setVpcId(vpcId) {
        this.props.vpcId = vpcId;
        return this;
    }
    setMaxAzs(maxAzs) {
        this.props.maxAzs = maxAzs;
        return this;
    }
    setNatGateways(count) {
        this.props.natGateways = count;
        return this;
    }
    setCidr(cidr) {
        this.props.cidr = cidr;
        return this;
    }
    setEnableDnsHostnames(enabled) {
        this.props.enableDnsHostnames = enabled;
        return this;
    }
    setEnableDnsSupport(enabled) {
        this.props.enableDnsSupport = enabled;
        return this;
    }
    setVpnGateway(enabled) {
        this.props.vpnGateway = enabled;
        return this;
    }
    setVpnRoutePropagation(routes) {
        this.props.vpnRoutePropagation = routes;
        return this;
    }
    setTags(tags) {
        this.props.tags = tags;
        return this;
    }
    addSubnetGroup(config) {
        this.subnetGroups.push({
            name: config.name,
            subnetType: config.subnetType,
            ...(config.cidrMask && { cidrMask: config.cidrMask }),
        });
        return this;
    }
    build() {
        if (!this.props.stack) {
            throw new Error('stack is required');
        }
        const stack = this.props.stack;
        if (this.props.vpcId) {
            const vpc = ec2.Vpc.fromLookup(stack, this.props.id || 'Vpc', {
                vpcId: this.props.vpcId,
            });
            return vpc;
        }
        const vpcProps = {
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
export const createVpc = (stack, props) => {
    const builder = new VpcBuilder(stack);
    if (props)
        Object.assign(builder['props'], props);
    return builder;
};
//# sourceMappingURL=vpc.js.map