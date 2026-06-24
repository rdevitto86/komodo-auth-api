import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
export class IamRoleBuilder {
    props = {};
    inlinePolicies = {};
    managedPolicies = [];
    constructor(stack) {
        this.props.stack = stack;
    }
    setRoleName(name) {
        this.props.roleName = name;
        return this;
    }
    setAssumedBy(principal) {
        this.props.assumedBy = principal;
        return this;
    }
    setDescription(description) {
        this.props.description = description;
        return this;
    }
    setPermissionsBoundary(policy) {
        this.props.permissionsBoundary = policy;
        return this;
    }
    addInlinePolicy(name, document) {
        this.inlinePolicies[name] = document;
        return this;
    }
    addManagedPolicy(policy) {
        this.managedPolicies.push(policy);
        return this;
    }
    setMaxSessionDuration(duration) {
        this.props.maxSessionDuration = duration;
        return this;
    }
    setPath(path) {
        this.props.path = path;
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
    props = {};
    statements = [];
    roles = [];
    users = [];
    groups = [];
    constructor(stack) {
        this.props.stack = stack;
    }
    setPolicyName(name) {
        this.props.policyName = name;
        return this;
    }
    setDescription(description) {
        this.props.description = description;
        return this;
    }
    addStatement(statement) {
        this.statements.push(statement);
        return this;
    }
    addStatements(statements) {
        this.statements.push(...statements);
        return this;
    }
    attachToRole(role) {
        this.roles.push(role);
        return this;
    }
    attachToRoles(roles) {
        this.roles.push(...roles);
        return this;
    }
    attachToUser(user) {
        this.users.push(user);
        return this;
    }
    attachToUsers(users) {
        this.users.push(...users);
        return this;
    }
    attachToGroup(group) {
        this.groups.push(group);
        return this;
    }
    attachToGroups(groups) {
        this.groups.push(...groups);
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
export const createIamRole = (stack, props) => {
    const builder = new IamRoleBuilder(stack);
    if (props) {
        Object.assign(builder['props'], props);
    }
    return builder;
};
export const createIamPolicy = (stack, props) => {
    const builder = new IamPolicyBuilder(stack);
    if (props) {
        Object.assign(builder['props'], props);
    }
    return builder;
};
export const attachPermissions = (role, statements) => {
    for (const statement of statements) {
        role.addToPrincipalPolicy(statement);
    }
};
//# sourceMappingURL=iam.js.map