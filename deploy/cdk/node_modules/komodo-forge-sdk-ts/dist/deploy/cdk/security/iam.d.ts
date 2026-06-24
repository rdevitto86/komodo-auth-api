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
export declare class IamRoleBuilder {
    private props;
    private inlinePolicies;
    private managedPolicies;
    constructor(stack: cdk.Stack);
    setRoleName(name: string): this;
    setAssumedBy(principal: iam.PrincipalBase): this;
    setDescription(description: string): this;
    setPermissionsBoundary(policy: iam.IManagedPolicy): this;
    addInlinePolicy(name: string, document: iam.PolicyDocument): this;
    addManagedPolicy(policy: iam.IManagedPolicy): this;
    setMaxSessionDuration(duration: cdk.Duration): this;
    setPath(path: string): this;
    setTags(tags: Record<string, string>): this;
    build(): iam.Role;
}
export declare class IamPolicyBuilder {
    private props;
    private statements;
    private roles;
    private users;
    private groups;
    constructor(stack: cdk.Stack);
    setPolicyName(name: string): this;
    setDescription(description: string): this;
    addStatement(statement: iam.PolicyStatement): this;
    addStatements(statements: iam.PolicyStatement[]): this;
    attachToRole(role: iam.IRole): this;
    attachToRoles(roles: iam.IRole[]): this;
    attachToUser(user: iam.IUser): this;
    attachToUsers(users: iam.IUser[]): this;
    attachToGroup(group: iam.IGroup): this;
    attachToGroups(groups: iam.IGroup[]): this;
    setTags(tags: Record<string, string>): this;
    build(): iam.ManagedPolicy;
}
export declare const createIamRole: (stack: cdk.Stack, props?: Partial<IamRoleProps>) => IamRoleBuilder;
export declare const createIamPolicy: (stack: cdk.Stack, props?: Partial<IamPolicyProps>) => IamPolicyBuilder;
export declare const attachPermissions: (role: iam.IRole, statements: iam.PolicyStatement[]) => void;
//# sourceMappingURL=iam.d.ts.map