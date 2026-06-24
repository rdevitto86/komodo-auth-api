import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

export interface SnsTopicProps {
	stack: cdk.Stack;
	topicName?: string;
	displayName?: string;
	fifo?: boolean;
	contentBasedDeduplication?: boolean;
	tags?: Record<string, string>;
}

export class SnsTopicBuilder {
	private props: Partial<SnsTopicProps> = {};
	private subscriptions: Array<{
		endpoint: string;
		protocol: sns.SubscriptionProtocol;
		filterPolicy?: { [attribute: string]: sns.SubscriptionFilter };
	}> = [];

	constructor(stack: cdk.Stack) {
		this.props.stack = stack;
	}

	setTopicName(name: string): this {
		this.props.topicName = name;
		return this;
	}

	setDisplayName(name: string): this {
		this.props.displayName = name;
		return this;
	}

	setFifo(enabled: boolean): this {
		this.props.fifo = enabled;
		return this;
	}

	setContentBasedDeduplication(enabled: boolean): this {
		this.props.contentBasedDeduplication = enabled;
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	addSubscription(config: {
		endpoint: string;
		protocol: sns.SubscriptionProtocol;
		filterPolicy?: { [attribute: string]: sns.SubscriptionFilter };
	}): this {
		this.subscriptions.push(config);
		return this;
	}

	build(): sns.Topic {
		if (!this.props.stack) {
			throw new Error('stack is required');
		}

		const topic = new sns.Topic(this.props.stack, this.props.topicName || 'SnsTopic', {
			...(this.props.displayName && { displayName: this.props.displayName }),
			...(this.props.fifo && { fifo: this.props.fifo }),
			...(this.props.contentBasedDeduplication && { contentBasedDeduplication: this.props.contentBasedDeduplication }),
			...(this.props.topicName && { topicName: this.props.topicName }),
		});

		if (this.props.tags) {
			Object.entries(this.props.tags).forEach(([key, value]) => {
				cdk.Tags.of(topic).add(key, value);
			});
		}

		for (const subscription of this.subscriptions) {
			topic.addSubscription(new subscriptions.EmailSubscription(subscription.endpoint));
		}
		return topic;
	}
}

export const createSnsTopic = (stack: cdk.Stack, props?: Partial<SnsTopicProps>): SnsTopicBuilder => {
	const builder = new SnsTopicBuilder(stack);
	if (props) Object.assign(builder['props'], props);
	return builder;
};
