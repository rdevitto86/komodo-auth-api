import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	attachPermissions,
	createIamPolicy,
	createIamRole,
	IamPolicyBuilder,
	type IamPolicyProps,
	IamRoleBuilder,
	type IamRoleProps,
} from './iam.js';
import { createKmsKey, KmsKeyBuilder, type KmsKeyProps } from './kms.js';
import { createSecret, SecretsManagerBuilder, type SecretsManagerProps } from './secretsManager.js';

describe('security/iam', () => {
	describe('IamRoleBuilder', () => {
		let mockStack: cdk.Stack;

		beforeEach(() => {
			mockStack = new cdk.Stack(undefined, 'TestStack', {
				env: {
					account: '123456789012',
					region: 'us-east-1',
				},
			});
		});

		it('should create builder with stack', () => {
			const builder = new IamRoleBuilder(mockStack);
			expect(builder).toBeInstanceOf(IamRoleBuilder);
		});

		it('should set role name', () => {
			const builder = new IamRoleBuilder(mockStack);
			const result = builder.setRoleName('test-role');
			expect(result).toBe(builder);
		});

		it('should set assumed by', () => {
			const builder = new IamRoleBuilder(mockStack);
			const principal = new iam.ServicePrincipal('lambda.amazonaws.com');
			const result = builder.setAssumedBy(principal);
			expect(result).toBe(builder);
		});

		it('should set description', () => {
			const builder = new IamRoleBuilder(mockStack);
			const result = builder.setDescription('Test role description');
			expect(result).toBe(builder);
		});

		it('should set permissions boundary', () => {
			const builder = new IamRoleBuilder(mockStack);
			const policy = new iam.ManagedPolicy(mockStack, 'TestPolicy');
			const result = builder.setPermissionsBoundary(policy);
			expect(result).toBe(builder);
		});

		it('should add inline policy', () => {
			const builder = new IamRoleBuilder(mockStack);
			const document = new iam.PolicyDocument();
			const result = builder.addInlinePolicy('test-policy', document);
			expect(result).toBe(builder);
		});

		it('should add managed policy', () => {
			const builder = new IamRoleBuilder(mockStack);
			const policy = new iam.ManagedPolicy(mockStack, 'TestPolicy');
			const result = builder.addManagedPolicy(policy);
			expect(result).toBe(builder);
		});

		it('should set max session duration', () => {
			const builder = new IamRoleBuilder(mockStack);
			const result = builder.setMaxSessionDuration(cdk.Duration.hours(1));
			expect(result).toBe(builder);
		});

		it('should set path', () => {
			const builder = new IamRoleBuilder(mockStack);
			const result = builder.setPath('/test/');
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new IamRoleBuilder(mockStack);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new IamRoleBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack is required');
		});

		it('should build role with defaults', () => {
			const builder = new IamRoleBuilder(mockStack);
			const role = builder.build();
			expect(role).toBeInstanceOf(iam.Role);
		});

		it('should build role with custom values', () => {
			const builder = new IamRoleBuilder(mockStack)
				.setRoleName('custom-role')
				.setDescription('Custom role description')
				.setPath('/custom/')
				.setTags({ Environment: 'test' });
			const role = builder.build();
			expect(role).toBeInstanceOf(iam.Role);
		});
	});

	describe('IamPolicyBuilder', () => {
		let mockStack: cdk.Stack;

		beforeEach(() => {
			mockStack = new cdk.Stack(undefined, 'TestStack', {
				env: {
					account: '123456789012',
					region: 'us-east-1',
				},
			});
		});

		it('should create builder with stack', () => {
			const builder = new IamPolicyBuilder(mockStack);
			expect(builder).toBeInstanceOf(IamPolicyBuilder);
		});

		it('should set policy name', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const result = builder.setPolicyName('test-policy');
			expect(result).toBe(builder);
		});

		it('should set description', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const result = builder.setDescription('Test policy description');
			expect(result).toBe(builder);
		});

		it('should add statement', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const statement = new iam.PolicyStatement();
			const result = builder.addStatement(statement);
			expect(result).toBe(builder);
		});

		it('should add statements', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const statements = [new iam.PolicyStatement(), new iam.PolicyStatement()];
			const result = builder.addStatements(statements);
			expect(result).toBe(builder);
		});

		it('should attach to role', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const role = new iam.Role(mockStack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
			const result = builder.attachToRole(role);
			expect(result).toBe(builder);
		});

		it('should attach to roles', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const role1 = new iam.Role(mockStack, 'TestRole1', {
				assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
			});
			const role2 = new iam.Role(mockStack, 'TestRole2', {
				assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
			});
			const result = builder.attachToRoles([role1, role2]);
			expect(result).toBe(builder);
		});

		it('should attach to user', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const user = new iam.User(mockStack, 'TestUser');
			const result = builder.attachToUser(user);
			expect(result).toBe(builder);
		});

		it('should attach to users', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const user1 = new iam.User(mockStack, 'TestUser1');
			const user2 = new iam.User(mockStack, 'TestUser2');
			const result = builder.attachToUsers([user1, user2]);
			expect(result).toBe(builder);
		});

		it('should attach to group', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const group = new iam.Group(mockStack, 'TestGroup');
			const result = builder.attachToGroup(group);
			expect(result).toBe(builder);
		});

		it('should attach to groups', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const group1 = new iam.Group(mockStack, 'TestGroup1');
			const group2 = new iam.Group(mockStack, 'TestGroup2');
			const result = builder.attachToGroups([group1, group2]);
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new IamPolicyBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack is required');
		});

		it('should build policy with defaults', () => {
			const builder = new IamPolicyBuilder(mockStack);
			const policy = builder.build();
			expect(policy).toBeInstanceOf(iam.ManagedPolicy);
		});

		it('should build policy with custom values', () => {
			const builder = new IamPolicyBuilder(mockStack)
				.setPolicyName('custom-policy')
				.setDescription('Custom policy description')
				.setTags({ Environment: 'test' });
			const policy = builder.build();
			expect(policy).toBeInstanceOf(iam.ManagedPolicy);
		});
	});

	describe('createIamRole', () => {
		it('should create builder with stack', () => {
			const mockStack = new cdk.Stack();
			const builder = createIamRole(mockStack);
			expect(builder).toBeInstanceOf(IamRoleBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const props: Partial<IamRoleProps> = {
				roleName: 'test-role',
				description: 'Test role',
			};
			const builder = createIamRole(mockStack, props);
			expect(builder).toBeInstanceOf(IamRoleBuilder);
		});
	});

	describe('createIamPolicy', () => {
		it('should create builder with stack', () => {
			const mockStack = new cdk.Stack();
			const builder = createIamPolicy(mockStack);
			expect(builder).toBeInstanceOf(IamPolicyBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const props: Partial<IamPolicyProps> = {
				policyName: 'test-policy',
				description: 'Test policy',
			};
			const builder = createIamPolicy(mockStack, props);
			expect(builder).toBeInstanceOf(IamPolicyBuilder);
		});
	});

	describe('attachPermissions', () => {
		it('should attach permissions to role', () => {
			const mockStack = new cdk.Stack();
			const role = new iam.Role(mockStack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
			const statements = [new iam.PolicyStatement()];
			expect(() => attachPermissions(role, statements)).not.toThrow();
		});
	});
});

describe('security/kms', () => {
	describe('KmsKeyBuilder', () => {
		let mockStack: cdk.Stack;

		beforeEach(() => {
			mockStack = new cdk.Stack(undefined, 'TestStack', {
				env: {
					account: '123456789012',
					region: 'us-east-1',
				},
			});
		});

		it('should create builder with stack', () => {
			const builder = new KmsKeyBuilder(mockStack);
			expect(builder).toBeInstanceOf(KmsKeyBuilder);
		});

		it('should set key id', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const result = builder.setKeyId('test-key-id');
			expect(result).toBe(builder);
		});

		it('should set alias', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const result = builder.setAlias('test-alias');
			expect(result).toBe(builder);
		});

		it('should set description', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const result = builder.setDescription('Test key description');
			expect(result).toBe(builder);
		});

		it('should set enable key rotation', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const result = builder.setEnableKeyRotation(true);
			expect(result).toBe(builder);
		});

		it('should set enabled', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const result = builder.setEnabled(false);
			expect(result).toBe(builder);
		});

		it('should set key usage', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const result = builder.setKeyUsage(kms.KeyUsage.ENCRYPT_DECRYPT);
			expect(result).toBe(builder);
		});

		it('should set key spec', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const result = builder.setKeySpec(kms.KeySpec.SYMMETRIC_DEFAULT);
			expect(result).toBe(builder);
		});

		it('should set removal policy', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const result = builder.setRemovalPolicy(cdk.RemovalPolicy.DESTROY);
			expect(result).toBe(builder);
		});

		it('should set policy', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const policy = new iam.PolicyDocument();
			const result = builder.setPolicy(policy);
			expect(result).toBe(builder);
		});

		it('should add administrator', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const admin = new iam.AccountPrincipal('123456789012');
			const result = builder.addAdministrator(admin);
			expect(result).toBe(builder);
		});

		it('should add administrators', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const admin1 = new iam.AccountPrincipal('123456789012');
			const admin2 = new iam.AccountPrincipal('123456789013');
			const result = builder.addAdministrators([admin1, admin2]);
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new KmsKeyBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack is required');
		});

		it('should build key with defaults', () => {
			const builder = new KmsKeyBuilder(mockStack);
			const key = builder.build();
			expect(key).toBeInstanceOf(kms.Key);
		});

		it('should build key with custom values', () => {
			const builder = new KmsKeyBuilder(mockStack)
				.setAlias('custom-alias')
				.setDescription('Custom key description')
				.setEnableKeyRotation(true)
				.setTags({ Environment: 'test' });
			const key = builder.build();
			expect(key).toBeInstanceOf(kms.Key);
		});

		it('should build key from lookup when keyId is set', () => {
			const builder = new KmsKeyBuilder(mockStack).setKeyId('alias/test-key-id');
			const key = builder.build();
			expect(key).toBeDefined();
		});
	});

	describe('createKmsKey', () => {
		it('should create builder with stack', () => {
			const mockStack = new cdk.Stack();
			const builder = createKmsKey(mockStack);
			expect(builder).toBeInstanceOf(KmsKeyBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const props: Partial<KmsKeyProps> = {
				alias: 'test-alias',
				description: 'Test key',
			};
			const builder = createKmsKey(mockStack, props);
			expect(builder).toBeInstanceOf(KmsKeyBuilder);
		});
	});
});

describe('security/secretsManager', () => {
	describe('SecretsManagerBuilder', () => {
		let mockStack: cdk.Stack;

		beforeEach(() => {
			mockStack = new cdk.Stack();
		});

		it('should create builder with stack', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			expect(builder).toBeInstanceOf(SecretsManagerBuilder);
		});

		it('should set secret name', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const result = builder.setSecretName('test-secret');
			expect(result).toBe(builder);
		});

		it('should set description', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const result = builder.setDescription('Test secret description');
			expect(result).toBe(builder);
		});

		it('should set secret string value', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const result = builder.setSecretStringValue('secret-value');
			expect(result).toBe(builder);
		});

		it('should set kms key', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const key = new kms.Key(mockStack, 'TestKey');
			const result = builder.setKmsKey(key);
			expect(result).toBe(builder);
		});

		it('should set removal policy', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const result = builder.setRemovalPolicy(cdk.RemovalPolicy.DESTROY);
			expect(result).toBe(builder);
		});

		it('should set replica regions', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const regions: secretsmanager.ReplicaRegion[] = [{ region: 'us-west-2' }];
			const result = builder.setReplicaRegions(regions);
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should add grant target', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const role = new iam.Role(mockStack, 'TestRole', { assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com') });
			const result = builder.addGrantTarget(role);
			expect(result).toBe(builder);
		});

		it('should add grant targets', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const role1 = new iam.Role(mockStack, 'TestRole1', {
				assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
			});
			const role2 = new iam.Role(mockStack, 'TestRole2', {
				assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
			});
			const result = builder.addGrantTargets([role1, role2]);
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack is required');
		});

		it('should build secret with defaults', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const secret = builder.build();
			expect(secret).toBeInstanceOf(secretsmanager.Secret);
		});

		it('should build secret with custom values', () => {
			const builder = new SecretsManagerBuilder(mockStack)
				.setSecretName('custom-secret')
				.setDescription('Custom secret description')
				.setSecretStringValue('custom-value')
				.setTags({ Environment: 'test' });
			const secret = builder.build();
			expect(secret).toBeInstanceOf(secretsmanager.Secret);
		});

		it('should build secret with kms key', () => {
			const builder = new SecretsManagerBuilder(mockStack);
			const key = new kms.Key(mockStack, 'TestKey');
			builder.setKmsKey(key);
			const secret = builder.build();
			expect(secret).toBeInstanceOf(secretsmanager.Secret);
		});
	});

	describe('createSecret', () => {
		it('should create builder with stack', () => {
			const mockStack = new cdk.Stack();
			const builder = createSecret(mockStack);
			expect(builder).toBeInstanceOf(SecretsManagerBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const props: Partial<SecretsManagerProps> = {
				secretName: 'test-secret',
				description: 'Test secret',
			};
			const builder = createSecret(mockStack, props);
			expect(builder).toBeInstanceOf(SecretsManagerBuilder);
		});
	});
});
