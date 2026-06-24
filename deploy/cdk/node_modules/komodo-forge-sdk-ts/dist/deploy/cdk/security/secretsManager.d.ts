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
export declare class SecretsManagerBuilder {
    private props;
    private grantTargets;
    constructor(stack: cdk.Stack);
    setSecretName(name: string): this;
    setDescription(description: string): this;
    setSecretStringValue(value: string): this;
    setKmsKey(key: kms.IKey): this;
    setRemovalPolicy(policy: cdk.RemovalPolicy): this;
    setReplicaRegions(regions: secretsmanager.ReplicaRegion[]): this;
    setTags(tags: Record<string, string>): this;
    addGrantTarget(grantee: iam.IGrantable): this;
    addGrantTargets(grantees: iam.IGrantable[]): this;
    build(): secretsmanager.Secret;
}
export declare const createSecret: (stack: cdk.Stack, props?: Partial<SecretsManagerProps>) => SecretsManagerBuilder;
//# sourceMappingURL=secretsManager.d.ts.map