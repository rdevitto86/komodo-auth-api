import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
export class SnsTopicBuilder {
    props = {};
    subscriptions = [];
    constructor(stack) {
        this.props.stack = stack;
    }
    setTopicName(name) {
        this.props.topicName = name;
        return this;
    }
    setDisplayName(name) {
        this.props.displayName = name;
        return this;
    }
    setFifo(enabled) {
        this.props.fifo = enabled;
        return this;
    }
    setContentBasedDeduplication(enabled) {
        this.props.contentBasedDeduplication = enabled;
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
export const createSnsTopic = (stack, props) => {
    const builder = new SnsTopicBuilder(stack);
    if (props)
        Object.assign(builder['props'], props);
    return builder;
};
//# sourceMappingURL=sns.js.map