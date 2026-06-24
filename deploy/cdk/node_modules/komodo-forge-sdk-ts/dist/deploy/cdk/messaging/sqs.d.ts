import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
export interface SqsQueueProps {
    stack: cdk.Stack;
    queueName?: string;
    visibilityTimeout?: cdk.Duration;
    retentionPeriod?: cdk.Duration;
    receiveMessageWaitTime?: cdk.Duration;
    deadLetterQueue?: sqs.IQueue;
    maxReceiveCount?: number;
    encryption?: sqs.QueueEncryption;
    encryptionMasterKey?: kms.IKey;
    contentBasedDeduplication?: boolean;
    fifo?: boolean;
    fifoThroughputLimit?: sqs.FifoThroughputLimit;
    deliveryDelay?: cdk.Duration;
    maxMessageSize?: number;
    messageRetentionPeriod?: cdk.Duration;
    tags?: Record<string, string>;
}
export declare class SqsQueueBuilder {
    private props;
    private subscriptions;
    constructor(stack: cdk.Stack);
    setQueueName(name: string): this;
    setVisibilityTimeout(timeout: cdk.Duration): this;
    setRetentionPeriod(period: cdk.Duration): this;
    setReceiveMessageWaitTime(time: cdk.Duration): this;
    setDeadLetterQueue(queue: sqs.IQueue, maxReceiveCount?: number): this;
    setEncryption(encryption: sqs.QueueEncryption): this;
    setEncryptionMasterKey(key: kms.IKey): this;
    setContentBasedDeduplication(enabled: boolean): this;
    setFifo(enabled: boolean): this;
    setFifoThroughputLimit(limit: sqs.FifoThroughputLimit): this;
    setDeliveryDelay(delay: cdk.Duration): this;
    setMaxMessageSize(size: number): this;
    setMessageRetentionPeriod(period: cdk.Duration): this;
    setTags(tags: Record<string, string>): this;
    addSubscription(config: {
        topic: sns.ITopic;
        filterPolicy?: {
            [attribute: string]: sns.SubscriptionFilter;
        };
    }): this;
    build(): sqs.Queue;
}
export declare const createSqsQueue: (stack: cdk.Stack, props?: Partial<SqsQueueProps>) => SqsQueueBuilder;
//# sourceMappingURL=sqs.d.ts.map