import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
export interface ManagedRuleGroup {
    vendorName?: string;
    name: string;
}
export interface RateLimitRule {
    name: string;
    limit: number;
    pathPrefix?: string;
}
export interface WafWebAclProps {
    metricPrefix: string;
    associateAlb?: elbv2.IApplicationLoadBalancer;
    managedRuleGroups?: ManagedRuleGroup[];
    globalRateLimit?: number;
    rateLimitRules?: RateLimitRule[];
    scope?: 'REGIONAL' | 'CLOUDFRONT';
}
export declare class WafWebAcl extends Construct {
    readonly webAcl: wafv2.CfnWebACL;
    constructor(scope: Construct, id: string, props: WafWebAclProps);
}
//# sourceMappingURL=wafWebAcl.d.ts.map