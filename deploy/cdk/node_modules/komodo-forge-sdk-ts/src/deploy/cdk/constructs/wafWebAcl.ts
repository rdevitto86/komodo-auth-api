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

export class WafWebAcl extends Construct {
	public readonly webAcl: wafv2.CfnWebACL;

	constructor(scope: Construct, id: string, props: WafWebAclProps) {
		super(scope, id);

		let priority = 0;
		const rules: wafv2.CfnWebACL.RuleProperty[] = [];

		for (const group of props.managedRuleGroups ?? []) {
			priority++;
			rules.push({
				name: group.name,
				priority,
				overrideAction: { none: {} },
				statement: {
					managedRuleGroupStatement: {
						vendorName: group.vendorName ?? 'AWS',
						name: group.name,
					},
				},
				visibilityConfig: {
					sampledRequestsEnabled: true,
					cloudWatchMetricsEnabled: true,
					metricName: group.name,
				},
			});
		}

		if (props.globalRateLimit) {
			priority++;
			rules.push({
				name: 'GlobalRateLimit',
				priority,
				action: { block: {} },
				statement: {
					rateBasedStatement: {
						limit: props.globalRateLimit,
						aggregateKeyType: 'IP',
					},
				},
				visibilityConfig: {
					sampledRequestsEnabled: true,
					cloudWatchMetricsEnabled: true,
					metricName: 'GlobalRateLimit',
				},
			});
		}

		for (const rule of props.rateLimitRules ?? []) {
			priority++;
			const statement: wafv2.CfnWebACL.StatementProperty = rule.pathPrefix
				? {
						rateBasedStatement: {
							limit: rule.limit,
							aggregateKeyType: 'IP',
							scopeDownStatement: {
								byteMatchStatement: {
									searchString: rule.pathPrefix,
									fieldToMatch: { uriPath: {} },
									textTransformations: [{ priority: 0, type: 'NONE' }],
									positionalConstraint: 'STARTS_WITH',
								},
							},
						},
					}
				: {
						rateBasedStatement: {
							limit: rule.limit,
							aggregateKeyType: 'IP',
						},
					};

			rules.push({
				name: rule.name,
				priority,
				action: { block: {} },
				statement,
				visibilityConfig: {
					sampledRequestsEnabled: true,
					cloudWatchMetricsEnabled: true,
					metricName: rule.name,
				},
			});
		}

		this.webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
			defaultAction: { allow: {} },
			scope: props.scope ?? 'REGIONAL',
			visibilityConfig: {
				sampledRequestsEnabled: true,
				cloudWatchMetricsEnabled: true,
				metricName: props.metricPrefix,
			},
			rules,
		});

		if (props.associateAlb) {
			new wafv2.CfnWebACLAssociation(this, 'AlbAssociation', {
				webAclArn: this.webAcl.attrArn,
				resourceArn: props.associateAlb.loadBalancerArn,
			});
		}
	}
}
