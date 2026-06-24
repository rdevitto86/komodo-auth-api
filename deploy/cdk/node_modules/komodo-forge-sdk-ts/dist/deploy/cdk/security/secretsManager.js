import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
export class SecretsManagerBuilder {
    props = {};
    grantTargets = [];
    constructor(stack) {
        this.props.stack = stack;
    }
    setSecretName(name) {
        this.props.secretName = name;
        return this;
    }
    setDescription(description) {
        this.props.description = description;
        return this;
    }
    setSecretStringValue(value) {
        this.props.secretStringValue = value;
        return this;
    }
    setKmsKey(key) {
        this.props.kmsKey = key;
        return this;
    }
    setRemovalPolicy(policy) {
        this.props.removalPolicy = policy;
        return this;
    }
    setReplicaRegions(regions) {
        this.props.replicaRegions = regions;
        return this;
    }
    setTags(tags) {
        this.props.tags = tags;
        return this;
    }
    addGrantTarget(grantee) {
        this.grantTargets.push(grantee);
        return this;
    }
    addGrantTargets(grantees) {
        this.grantTargets.push(...grantees);
        return this;
    }
    build() {
        if (!this.props.stack) {
            throw new Error('stack is required');
        }
        const secret = new secretsmanager.Secret(this.props.stack, this.props.secretName || 'Secret', {
            ...(this.props.description && { description: this.props.description }),
            ...(this.props.secretStringValue && { secretStringValue: this.props.secretStringValue }),
            ...(this.props.kmsKey && { encryptionKey: this.props.kmsKey }),
            ...(this.props.removalPolicy && { removalPolicy: this.props.removalPolicy }),
            ...(this.props.replicaRegions && { replicaRegions: this.props.replicaRegions }),
        });
        if (this.props.tags) {
            Object.entries(this.props.tags).forEach(([key, value]) => {
                cdk.Tags.of(secret).add(key, value);
            });
        }
        for (const grantee of this.grantTargets) {
            secret.grantRead(grantee);
        }
        return secret;
    }
}
export const createSecret = (stack, props) => {
    const builder = new SecretsManagerBuilder(stack);
    if (props)
        Object.assign(builder['props'], props);
    return builder;
};
//# sourceMappingURL=secretsManager.js.map