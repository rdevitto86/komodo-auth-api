import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
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

export class SqsQueueBuilder {
	private props: Partial<SqsQueueProps> = {};
	private subscriptions: Array<{
		topic: sns.ITopic;
		filterPolicy?: { [attribute: string]: sns.SubscriptionFilter };
	}> = [];

	constructor(stack: cdk.Stack) {
		this.props.stack = stack;
	}

	setQueueName(name: string): this {
		this.props.queueName = name;
		return this;
	}

	setVisibilityTimeout(timeout: cdk.Duration): this {
		this.props.visibilityTimeout = timeout;
		return this;
	}

	setRetentionPeriod(period: cdk.Duration): this {
		this.props.retentionPeriod = period;
		return this;
	}

	setReceiveMessageWaitTime(time: cdk.Duration): this {
		this.props.receiveMessageWaitTime = time;
		return this;
	}

	setDeadLetterQueue(queue: sqs.IQueue, maxReceiveCount?: number): this {
		this.props.deadLetterQueue = queue;
		if (maxReceiveCount !== undefined) {
			this.props.maxReceiveCount = maxReceiveCount;
		}
		return this;
	}

	setEncryption(encryption: sqs.QueueEncryption): this {
		this.props.encryption = encryption;
		return this;
	}

	setEncryptionMasterKey(key: kms.IKey): this {
		this.props.encryptionMasterKey = key;
		return this;
	}

	setContentBasedDeduplication(enabled: boolean): this {
		this.props.contentBasedDeduplication = enabled;
		return this;
	}

	setFifo(enabled: boolean): this {
		this.props.fifo = enabled;
		return this;
	}

	setFifoThroughputLimit(limit: sqs.FifoThroughputLimit): this {
		this.props.fifoThroughputLimit = limit;
		return this;
	}

	setDeliveryDelay(delay: cdk.Duration): this {
		this.props.deliveryDelay = delay;
		return this;
	}

	setMaxMessageSize(size: number): this {
		this.props.maxMessageSize = size;
		return this;
	}

	setMessageRetentionPeriod(period: cdk.Duration): this {
		this.props.messageRetentionPeriod = period;
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	addSubscription(config: { topic: sns.ITopic; filterPolicy?: { [attribute: string]: sns.SubscriptionFilter } }): this {
		this.subscriptions.push(config);
		return this;
	}

	build(): sqs.Queue {
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
			subscription.topic.addSubscription(
				new subscriptions.SqsSubscription(queue, {
					...(subscription.filterPolicy && { filterPolicy: subscription.filterPolicy }),
				}),
			);
		}

		return queue;
	}
}

export const createSqsQueue = (stack: cdk.Stack, props?: Partial<SqsQueueProps>): SqsQueueBuilder => {
	const builder = new SqsQueueBuilder(stack);
	if (props) Object.assign(builder['props'], props);
	return builder;
};
