import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';

export interface KmsKeyProps {
	stack: cdk.Stack;
	keyId?: string;
	alias?: string;
	description?: string;
	enableKeyRotation?: boolean;
	enabled?: boolean;
	keyUsage?: kms.KeyUsage;
	keySpec?: kms.KeySpec;
	removalPolicy?: cdk.RemovalPolicy;
	policy?: iam.PolicyDocument;
	administrators?: iam.IPrincipal[];
	tags?: Record<string, string>;
}

export class KmsKeyBuilder {
	private props: Partial<KmsKeyProps> = {};
	private administrators: iam.IPrincipal[] = [];

	constructor(stack: cdk.Stack) {
		this.props.stack = stack;
	}

	setKeyId(keyId: string): this {
		this.props.keyId = keyId;
		return this;
	}

	setAlias(alias: string): this {
		this.props.alias = alias;
		return this;
	}

	setDescription(description: string): this {
		this.props.description = description;
		return this;
	}

	setEnableKeyRotation(enabled: boolean): this {
		this.props.enableKeyRotation = enabled;
		return this;
	}

	setEnabled(enabled: boolean): this {
		this.props.enabled = enabled;
		return this;
	}

	setKeyUsage(usage: kms.KeyUsage): this {
		this.props.keyUsage = usage;
		return this;
	}

	setKeySpec(spec: kms.KeySpec): this {
		this.props.keySpec = spec;
		return this;
	}

	setRemovalPolicy(policy: cdk.RemovalPolicy): this {
		this.props.removalPolicy = policy;
		return this;
	}

	setPolicy(policy: iam.PolicyDocument): this {
		this.props.policy = policy;
		return this;
	}

	addAdministrator(admin: iam.IPrincipal): this {
		this.administrators.push(admin);
		return this;
	}

	addAdministrators(admins: iam.IPrincipal[]): this {
		this.administrators.push(...admins);
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	build(): kms.Key {
		if (!this.props.stack) {
			throw new Error('stack is required');
		}

		const stack = this.props.stack;

		if (this.props.keyId) {
			const key = kms.Key.fromLookup(stack, this.props.keyId, {
				aliasName: this.props.keyId,
			});
			return key as kms.Key;
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

export const createKmsKey = (stack: cdk.Stack, props?: Partial<KmsKeyProps>): KmsKeyBuilder => {
	const builder = new KmsKeyBuilder(stack);
	if (props) Object.assign(builder['props'], props);
	return builder;
};
