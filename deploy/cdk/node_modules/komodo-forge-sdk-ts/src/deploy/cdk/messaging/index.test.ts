import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSnsTopic, SnsTopicBuilder, type SnsTopicProps } from './sns.js';
import { createSqsQueue, SqsQueueBuilder, type SqsQueueProps } from './sqs.js';

describe('messaging/sqs', () => {
	describe('SqsQueueBuilder', () => {
		let mockStack: cdk.Stack;

		beforeEach(() => {
			mockStack = new cdk.Stack();
		});

		it('should create builder with stack', () => {
			const builder = new SqsQueueBuilder(mockStack);
			expect(builder).toBeInstanceOf(SqsQueueBuilder);
		});

		it('should set queue name', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setQueueName('test-queue');
			expect(result).toBe(builder);
		});

		it('should set visibility timeout', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setVisibilityTimeout(cdk.Duration.seconds(30));
			expect(result).toBe(builder);
		});

		it('should set retention period', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setRetentionPeriod(cdk.Duration.days(7));
			expect(result).toBe(builder);
		});

		it('should set receive message wait time', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setReceiveMessageWaitTime(cdk.Duration.seconds(20));
			expect(result).toBe(builder);
		});

		it('should set dead letter queue', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const dlq = new sqs.Queue(mockStack, 'TestDLQ');
			const result = builder.setDeadLetterQueue(dlq, 5);
			expect(result).toBe(builder);
		});

		it('should set encryption', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setEncryption(sqs.QueueEncryption.KMS);
			expect(result).toBe(builder);
		});

		it('should set encryption master key', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const key = new kms.Key(mockStack, 'TestKey');
			const result = builder.setEncryptionMasterKey(key);
			expect(result).toBe(builder);
		});

		it('should set content based deduplication', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setContentBasedDeduplication(true);
			expect(result).toBe(builder);
		});

		it('should set fifo', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setFifo(true);
			expect(result).toBe(builder);
		});

		it('should set fifo throughput limit', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setFifoThroughputLimit(sqs.FifoThroughputLimit.PER_QUEUE);
			expect(result).toBe(builder);
		});

		it('should set delivery delay', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setDeliveryDelay(cdk.Duration.seconds(10));
			expect(result).toBe(builder);
		});

		it('should set max message size', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setMaxMessageSize(256000);
			expect(result).toBe(builder);
		});

		it('should set message retention period', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const result = builder.setMessageRetentionPeriod(cdk.Duration.days(14));
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should add subscription', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const topic = new sns.Topic(mockStack, 'TestTopic');
			const result = builder.addSubscription({ topic });
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new SqsQueueBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack is required');
		});

		it('should build queue with defaults', () => {
			const builder = new SqsQueueBuilder(mockStack);
			const queue = builder.build();
			expect(queue).toBeInstanceOf(sqs.Queue);
		});

		it('should build queue with custom values', () => {
			const builder = new SqsQueueBuilder(mockStack)
				.setQueueName('custom-queue')
				.setVisibilityTimeout(cdk.Duration.seconds(60))
				.setRetentionPeriod(cdk.Duration.days(14))
				.setTags({ Environment: 'test' });
			const queue = builder.build();
			expect(queue).toBeInstanceOf(sqs.Queue);
		});
	});

	describe('createSqsQueue', () => {
		it('should create builder with stack', () => {
			const mockStack = new cdk.Stack();
			const builder = createSqsQueue(mockStack);
			expect(builder).toBeInstanceOf(SqsQueueBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const props: Partial<SqsQueueProps> = {
				queueName: 'test-queue',
				visibilityTimeout: cdk.Duration.seconds(30),
			};
			const builder = createSqsQueue(mockStack, props);
			expect(builder).toBeInstanceOf(SqsQueueBuilder);
		});
	});
});

describe('messaging/sns', () => {
	describe('SnsTopicBuilder', () => {
		let mockStack: cdk.Stack;

		beforeEach(() => {
			mockStack = new cdk.Stack();
		});

		it('should create builder with stack', () => {
			const builder = new SnsTopicBuilder(mockStack);
			expect(builder).toBeInstanceOf(SnsTopicBuilder);
		});

		it('should set topic name', () => {
			const builder = new SnsTopicBuilder(mockStack);
			const result = builder.setTopicName('test-topic');
			expect(result).toBe(builder);
		});

		it('should set display name', () => {
			const builder = new SnsTopicBuilder(mockStack);
			const result = builder.setDisplayName('Test Topic');
			expect(result).toBe(builder);
		});

		it('should set fifo', () => {
			const builder = new SnsTopicBuilder(mockStack);
			const result = builder.setFifo(true);
			expect(result).toBe(builder);
		});

		it('should set content based deduplication', () => {
			const builder = new SnsTopicBuilder(mockStack);
			const result = builder.setContentBasedDeduplication(true);
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new SnsTopicBuilder(mockStack);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should add subscription', () => {
			const builder = new SnsTopicBuilder(mockStack);
			const result = builder.addSubscription({
				endpoint: 'test@example.com',
				protocol: sns.SubscriptionProtocol.EMAIL,
			});
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new SnsTopicBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack is required');
		});

		it('should build topic with defaults', () => {
			const builder = new SnsTopicBuilder(mockStack);
			const topic = builder.build();
			expect(topic).toBeInstanceOf(sns.Topic);
		});

		it('should build topic with custom values', () => {
			const builder = new SnsTopicBuilder(mockStack)
				.setTopicName('custom-topic')
				.setDisplayName('Custom Topic')
				.setTags({ Environment: 'test' });
			const topic = builder.build();
			expect(topic).toBeInstanceOf(sns.Topic);
		});
	});

	describe('createSnsTopic', () => {
		it('should create builder with stack', () => {
			const mockStack = new cdk.Stack();
			const builder = createSnsTopic(mockStack);
			expect(builder).toBeInstanceOf(SnsTopicBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const props: Partial<SnsTopicProps> = {
				topicName: 'test-topic',
				displayName: 'Test Topic',
			};
			const builder = createSnsTopic(mockStack, props);
			expect(builder).toBeInstanceOf(SnsTopicBuilder);
		});
	});
});
