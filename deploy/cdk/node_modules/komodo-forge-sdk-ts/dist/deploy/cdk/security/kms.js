import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
export class KmsKeyBuilder {
    props = {};
    administrators = [];
    constructor(stack) {
        this.props.stack = stack;
    }
    setKeyId(keyId) {
        this.props.keyId = keyId;
        return this;
    }
    setAlias(alias) {
        this.props.alias = alias;
        return this;
    }
    setDescription(description) {
        this.props.description = description;
        return this;
    }
    setEnableKeyRotation(enabled) {
        this.props.enableKeyRotation = enabled;
        return this;
    }
    setEnabled(enabled) {
        this.props.enabled = enabled;
        return this;
    }
    setKeyUsage(usage) {
        this.props.keyUsage = usage;
        return this;
    }
    setKeySpec(spec) {
        this.props.keySpec = spec;
        return this;
    }
    setRemovalPolicy(policy) {
        this.props.removalPolicy = policy;
        return this;
    }
    setPolicy(policy) {
        this.props.policy = policy;
        return this;
    }
    addAdministrator(admin) {
        this.administrators.push(admin);
        return this;
    }
    addAdministrators(admins) {
        this.administrators.push(...admins);
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
        const stack = this.props.stack;
        if (this.props.keyId) {
            const key = kms.Key.fromLookup(stack, this.props.keyId, {
                aliasName: this.props.keyId,
            });
            return key;
        }
        const key = new kms.Key(stack, this.props.alias || 'KmsKey', {
            ...(this.props.description && { description: this.props.description }),
            enableKeyRotation: this.props.enableKeyRotation || false,
            enabled: this.props.enabled !== false,
            ...(this.props.keyUsage && { keyUsage: this.props.keyUsage }),
            ...(this.props.keySpec && { keySpec: this.props.keySpec }),
            ...(this.props.removalPolicy && { removalPolicy: this.props.removalPolicy }),
            ...(this.props.policy && { policy: this.props.policy }),
            ...(this.props.alias && { aliasName: this.props.alias }),
        });
        if (this.props.tags) {
            Object.entries(this.props.tags).forEach(([k, v]) => {
                cdk.Tags.of(key).add(k, v);
            });
        }
        for (const admin of this.administrators) {
            key.grantAdmin(admin);
        }
        return key;
    }
}
export const createKmsKey = (stack, props) => {
    const builder = new KmsKeyBuilder(stack);
    if (props)
        Object.assign(builder['props'], props);
    return builder;
};
//# sourceMappingURL=kms.js.map