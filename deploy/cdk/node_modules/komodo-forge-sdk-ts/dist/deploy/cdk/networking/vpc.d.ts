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
export declare class VpcBuilder {
    private props;
    private subnetGroups;
    constructor(stack: cdk.Stack);
    setId(id: string): this;
    setVpcId(vpcId: string): this;
    setMaxAzs(maxAzs: number): this;
    setNatGateways(count: number): this;
    setCidr(cidr: string): this;
    setEnableDnsHostnames(enabled: boolean): this;
    setEnableDnsSupport(enabled: boolean): this;
    setVpnGateway(enabled: boolean): this;
    setVpnRoutePropagation(routes: ec2.SubnetSelection[]): this;
    setTags(tags: Record<string, string>): this;
    addSubnetGroup(config: {
        name: string;
        subnetType: ec2.SubnetType;
        cidrMask?: number;
    }): this;
    build(): ec2.Vpc;
}
export declare const createVpc: (stack: cdk.Stack, props?: Partial<VpcProps>) => VpcBuilder;
//# sourceMappingURL=vpc.d.ts.map