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
export declare class KmsKeyBuilder {
    private props;
    private administrators;
    constructor(stack: cdk.Stack);
    setKeyId(keyId: string): this;
    setAlias(alias: string): this;
    setDescription(description: string): this;
    setEnableKeyRotation(enabled: boolean): this;
    setEnabled(enabled: boolean): this;
    setKeyUsage(usage: kms.KeyUsage): this;
    setKeySpec(spec: kms.KeySpec): this;
    setRemovalPolicy(policy: cdk.RemovalPolicy): this;
    setPolicy(policy: iam.PolicyDocument): this;
    addAdministrator(admin: iam.IPrincipal): this;
    addAdministrators(admins: iam.IPrincipal[]): this;
    setTags(tags: Record<string, string>): this;
    build(): kms.Key;
}
export declare const createKmsKey: (stack: cdk.Stack, props?: Partial<KmsKeyProps>) => KmsKeyBuilder;
//# sourceMappingURL=kms.d.ts.map