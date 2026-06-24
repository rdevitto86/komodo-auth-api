import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
export class SqsQueueBuilder {
    props = {};
    subscriptions = [];
    constructor(stack) {
        this.props.stack = stack;
    }
    setQueueName(name) {
        this.props.queueName = name;
        return this;
    }
    setVisibilityTimeout(timeout) {
        this.props.visibilityTimeout = timeout;
        return this;
    }
    setRetentionPeriod(period) {
        this.props.retentionPeriod = period;
        return this;
    }
    setReceiveMessageWaitTime(time) {
        this.props.receiveMessageWaitTime = time;
        return this;
    }
    setDeadLetterQueue(queue, maxReceiveCount) {
        this.props.deadLetterQueue = queue;
        if (maxReceiveCount !== undefined) {
            this.props.maxReceiveCount = maxReceiveCount;
        }
        return this;
    }
    setEncryption(encryption) {
        this.props.encryption = encryption;
        return this;
    }
    setEncryptionMasterKey(key) {
        this.props.encryptionMasterKey = key;
        return this;
    }
    setContentBasedDeduplication(enabled) {
        this.props.contentBasedDeduplication = enabled;
        return this;
    }
    setFifo(enabled) {
        this.props.fifo = enabled;
        return this;
    }
    setFifoThroughputLimit(limit) {
        this.props.fifoThroughputLimit = limit;
        return this;
    }
    setDeliveryDelay(delay) {
        this.props.deliveryDelay = delay;
        return this;
    }
    setMaxMessageSize(size) {
        this.props.maxMessageSize = size;
        return this;
    }
    setMessageRetentionPeriod(period) {
        this.props.messageRetentionPeriod = period;
        return this;
    }
    setTags(tags) {
        this.props.tags = tags;
        return this;
    }
    addSubscription(config) {
        this.subscriptions.push(config);
        return this;
    }
    build() {
        if (!this.props.stack) {
            throw new Error('stack is required');
        }
        const queue = new sqs.Queue(this.props.stack, this.props.queueName || 'SqsQueue', {
            ...(this.props.visibilityTimeout && { visibilityTimeout: this.props.visibilityTimeout }),
            ...(this.props.retentionPeriod && { retentionPeriod: this.props.retentionPeriod }),
            ...(this.props.receiveMessageWaitTime && { receiveMessageWaitTime: this.props.receiveMessageWaitTime }),
            ...(this.props.deadLetterQueue && {
                deadLetterQueue: {
                    queue: this.props.deadLetterQueue,
                    maxReceiveCount: this.props.maxReceiveCount || 3,
                },
            }),
            encryption: this.props.encryption || sqs.QueueEncryption.SQS_MANAGED,
            ...(this.props.encryptionMasterKey && { encryptionMasterKey: this.props.encryptionMasterKey }),
            ...(this.props.contentBasedDeduplication && { contentBasedDeduplication: this.props.contentBasedDeduplication }),
            ...(this.props.fifo && { fifo: this.props.fifo }),
            ...(this.props.fifoThroughputLimit && { fifoThroughputLimit: this.props.fifoThroughputLimit }),
            ...(this.props.deliveryDelay && { deliveryDelay: this.props.deliveryDelay }),
            ...(this.props.maxMessageSize && { maxMessageSize: this.props.maxMessageSize }),
            ...(this.props.messageRetentionPeriod && { messageRetentionPeriod: this.props.messageRetentionPeriod }),
        });
        if (this.props.tags) {
            Object.entries(this.props.tags).forEach(([key, value]) => {
                cdk.Tags.of(queue).add(key, value);
            });
        }
        for (const subscription of this.subscriptions) {
            subscription.topic.addSubscription(new subscriptions.SqsSubscription(queue, {
                ...(subscription.filterPolicy && { filterPolicy: subscription.filterPolicy }),
            }));
        }
        return queue;
    }
}
export const createSqsQueue = (stack, props) => {
    const builder = new SqsQueueBuilder(stack);
    if (props)
        Object.assign(builder['props'], props);
    return builder;
};
//# sourceMappingURL=sqs.js.map