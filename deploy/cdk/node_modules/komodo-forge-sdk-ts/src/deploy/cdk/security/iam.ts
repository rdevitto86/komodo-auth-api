import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface IamRoleProps {
	stack: cdk.Stack;
	roleName?: string;
	assumedBy?: iam.PrincipalBase;
	description?: string;
	permissionsBoundary?: iam.IManagedPolicy;
	inlinePolicies?: Record<string, iam.PolicyDocument>;
	managedPolicies?: iam.IManagedPolicy[];
	maxSessionDuration?: cdk.Duration;
	path?: string;
	tags?: Record<string, string>;
}

export interface IamPolicyProps {
	stack: cdk.Stack;
	policyName?: string;
	statements?: iam.PolicyStatement[];
	description?: string;
	roles?: iam.IRole[];
	users?: iam.IUser[];
	groups?: iam.IGroup[];
	tags?: Record<string, string>;
}

export class IamRoleBuilder {
	private props: Partial<IamRoleProps> = {};
	private inlinePolicies: Record<string, iam.PolicyDocument> = {};
	private managedPolicies: iam.IManagedPolicy[] = [];

	constructor(stack: cdk.Stack) {
		this.props.stack = stack;
	}

	setRoleName(name: string): this {
		this.props.roleName = name;
		return this;
	}

	setAssumedBy(principal: iam.PrincipalBase): this {
		this.props.assumedBy = principal;
		return this;
	}

	setDescription(description: string): this {
		this.props.description = description;
		return this;
	}

	setPermissionsBoundary(policy: iam.IManagedPolicy): this {
		this.props.permissionsBoundary = policy;
		return this;
	}

	addInlinePolicy(name: string, document: iam.PolicyDocument): this {
		this.inlinePolicies[name] = document;
		return this;
	}

	addManagedPolicy(policy: iam.IManagedPolicy): this {
		this.managedPolicies.push(policy);
		return this;
	}

	setMaxSessionDuration(duration: cdk.Duration): this {
		this.props.maxSessionDuration = duration;
		return this;
	}

	setPath(path: string): this {
		this.props.path = path;
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	build(): iam.Role {
		if (!this.props.stack) {
			throw new Error('stack is required');
		}

		const role = new iam.Role(this.props.stack, this.props.roleName || 'IamRole', {
			assumedBy: this.props.assumedBy || new iam.ServicePrincipal('lambda.amazonaws.com'),
			...(this.props.description && { description: this.props.description }),
			...(this.props.permissionsBoundary && { permissionsBoundary: this.props.permissionsBoundary }),
			...(Object.keys(this.inlinePolicies).length > 0 && { inlinePolicies: this.inlinePolicies }),
			...(this.managedPolicies.length > 0 && { managedPolicies: this.managedPolicies }),
			...(this.props.maxSessionDuration && { maxSessionDuration: this.props.maxSessionDuration }),
			...(this.props.path && { path: this.props.path }),
		});

		if (this.props.tags) {
			Object.entries(this.props.tags).forEach(([key, value]) => {
				cdk.Tags.of(role).add(key, value);
			});
		}

		return role;
	}
}

export class IamPolicyBuilder {
	private props: Partial<IamPolicyProps> = {};
	private statements: iam.PolicyStatement[] = [];
	private roles: iam.IRole[] = [];
	private users: iam.IUser[] = [];
	private groups: iam.IGroup[] = [];

	constructor(stack: cdk.Stack) {
		this.props.stack = stack;
	}

	setPolicyName(name: string): this {
		this.props.policyName = name;
		return this;
	}

	setDescription(description: string): this {
		this.props.description = description;
		return this;
	}

	addStatement(statement: iam.PolicyStatement): this {
		this.statements.push(statement);
		return this;
	}

	addStatements(statements: iam.PolicyStatement[]): this {
		this.statements.push(...statements);
		return this;
	}

	attachToRole(role: iam.IRole): this {
		this.roles.push(role);
		return this;
	}

	attachToRoles(roles: iam.IRole[]): this {
		this.roles.push(...roles);
		return this;
	}

	attachToUser(user: iam.IUser): this {
		this.users.push(user);
		return this;
	}

	attachToUsers(users: iam.IUser[]): this {
		this.users.push(...users);
		return this;
	}

	attachToGroup(group: iam.IGroup): this {
		this.groups.push(group);
		return this;
	}

	attachToGroups(groups: iam.IGroup[]): this {
		this.groups.push(...groups);
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	build(): iam.ManagedPolicy {
		if (!this.props.stack) {
			throw new Error('stack is required');
		}

		const stack = this.props.stack;

		const policy = new iam.ManagedPolicy(stack, this.props.policyName || 'IamPolicy', {
			...(this.props.description && { description: this.props.description }),
			...(this.statements.length > 0 && { statements: this.statements }),
			...(this.roles.length > 0 && { roles: this.roles }),
			...(this.users.length > 0 && { users: this.users }),
			...(this.groups.length > 0 && { groups: this.groups }),
		});

		if (this.props.tags) {
			Object.entries(this.props.tags).forEach(([key, value]) => {
				cdk.Tags.of(policy).add(key, value);
			});
		}

		return policy;
	}
}

export const createIamRole = (stack: cdk.Stack, props?: Partial<IamRoleProps>): IamRoleBuilder => {
	const builder = new IamRoleBuilder(stack);

	if (props) {
		Object.assign(builder['props'], props);
	}

	return builder;
};

export const createIamPolicy = (stack: cdk.Stack, props?: Partial<IamPolicyProps>): IamPolicyBuilder => {
	const builder = new IamPolicyBuilder(stack);

	if (props) {
		Object.assign(builder['props'], props);
	}

	return builder;
};

export const attachPermissions = (role: iam.IRole, statements: iam.PolicyStatement[]) => {
	for (const statement of statements) {
		role.addToPrincipalPolicy(statement);
	}
};
