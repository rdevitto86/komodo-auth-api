import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface SecretsManagerProps {
	stack: cdk.Stack;
	secretName?: string;
	description?: string;
	secretStringValue?: string;
	kmsKey?: kms.IKey;
	removalPolicy?: cdk.RemovalPolicy;
	replicaRegions?: secretsmanager.ReplicaRegion[];
	tags?: Record<string, string>;
}

export class SecretsManagerBuilder {
	private props: Partial<SecretsManagerProps> = {};
	private grantTargets: iam.IGrantable[] = [];

	constructor(stack: cdk.Stack) {
		this.props.stack = stack;
	}

	setSecretName(name: string): this {
		this.props.secretName = name;
		return this;
	}

	setDescription(description: string): this {
		this.props.description = description;
		return this;
	}

	setSecretStringValue(value: string): this {
		this.props.secretStringValue = value;
		return this;
	}

	setKmsKey(key: kms.IKey): this {
		this.props.kmsKey = key;
		return this;
	}

	setRemovalPolicy(policy: cdk.RemovalPolicy): this {
		this.props.removalPolicy = policy;
		return this;
	}

	setReplicaRegions(regions: secretsmanager.ReplicaRegion[]): this {
		this.props.replicaRegions = regions;
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	addGrantTarget(grantee: iam.IGrantable): this {
		this.grantTargets.push(grantee);
		return this;
	}

	addGrantTargets(grantees: iam.IGrantable[]): this {
		this.grantTargets.push(...grantees);
		return this;
	}

	build(): secretsmanager.Secret {
		if (!this.props.stack) {
			throw new Error('stack is required');
		}

		const secret = new secretsmanager.Secret(this.props.stack, this.props.secretName || 'Secret', {
			...(this.props.description && { description: this.props.description }),
			...(this.props.secretStringValue && { secretStringValue: this.props.secretStringValue as any }),
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

export const createSecret = (stack: cdk.Stack, props?: Partial<SecretsManagerProps>): SecretsManagerBuilder => {
	const builder = new SecretsManagerBuilder(stack);
	if (props) Object.assign(builder['props'], props);
	return builder;
};
