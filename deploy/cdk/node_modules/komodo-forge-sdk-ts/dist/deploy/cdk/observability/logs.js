import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
export class LogGroupBuilder {
    props = {};
    constructor(stack) {
        this.props.stack = stack;
    }
    setLogGroupName(name) {
        this.props.logGroupName = name;
        return this;
    }
    setRetention(retention) {
        this.props.retention = retention;
        return this;
    }
    setRemovalPolicy(policy) {
        this.props.removalPolicy = policy;
        return this;
    }
    setEncryptionKey(key) {
        this.props.encryptionKey = key;
        return this;
    }
    setTags(tags) {
        this.props.tags = tags;
        return this;
    }
    build() {
        if (!this.props.stack) {
            throw new Error('stack is required');
        }
        const logGroup = new logs.LogGroup(this.props.stack, this.props.logGroupName || 'LogGroup', {
            ...(this.props.logGroupName && { logGroupName: this.props.logGroupName }),
            retention: this.props.retention || logs.RetentionDays.ONE_WEEK,
            ...(this.props.removalPolicy && { removalPolicy: this.props.removalPolicy }),
            ...(this.props.encryptionKey && { encryptionKey: this.props.encryptionKey }),
        });
        if (this.props.tags) {
            Object.entries(this.props.tags).forEach(([key, value]) => {
                cdk.Tags.of(logGroup).add(key, value);
            });
        }
        return logGroup;
    }
}
export const createLogGroup = (stack, props) => {
    const builder = new LogGroupBuilder(stack);
    if (props) {
        if (props.logGroupName)
            builder.setLogGroupName(props.logGroupName);
        if (props.retention)
            builder.setRetention(props.retention);
        if (props.removalPolicy)
            builder.setRemovalPolicy(props.removalPolicy);
        if (props.encryptionKey)
            builder.setEncryptionKey(props.encryptionKey);
        if (props.tags)
            builder.setTags(props.tags);
    }
    return builder;
};
//# sourceMappingURL=logs.js.map