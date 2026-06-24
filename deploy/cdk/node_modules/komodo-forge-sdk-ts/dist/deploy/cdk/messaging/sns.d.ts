import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
export interface SnsTopicProps {
    stack: cdk.Stack;
    topicName?: string;
    displayName?: string;
    fifo?: boolean;
    contentBasedDeduplication?: boolean;
    tags?: Record<string, string>;
}
export declare class SnsTopicBuilder {
    private props;
    private subscriptions;
    constructor(stack: cdk.Stack);
    setTopicName(name: string): this;
    setDisplayName(name: string): this;
    setFifo(enabled: boolean): this;
    setContentBasedDeduplication(enabled: boolean): this;
    setTags(tags: Record<string, string>): this;
    addSubscription(config: {
        endpoint: string;
        protocol: sns.SubscriptionProtocol;
        filterPolicy?: {
            [attribute: string]: sns.SubscriptionFilter;
        };
    }): this;
    build(): sns.Topic;
}
export declare const createSnsTopic: (stack: cdk.Stack, props?: Partial<SnsTopicProps>) => SnsTopicBuilder;
//# sourceMappingURL=sns.d.ts.map