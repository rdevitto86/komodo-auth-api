import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
export class WafWebAcl extends Construct {
    webAcl;
    constructor(scope, id, props) {
        super(scope, id);
        let priority = 0;
        const rules = [];
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
            const statement = rule.pathPrefix
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
//# sourceMappingURL=wafWebAcl.js.map