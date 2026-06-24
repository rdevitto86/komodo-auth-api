import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
export interface LambdaFunctionProps {
    stack: cdk.Stack;
    functionName?: string;
    description?: string;
    runtime?: lambda.Runtime;
    handler?: string;
    code?: lambda.Code;
    environment?: Record<string, string>;
    layers?: lambda.ILayerVersion[];
    memorySize?: number;
    timeout?: cdk.Duration;
    reservedConcurrentExecutions?: number;
    role?: iam.Role;
    logRetention?: logs.RetentionDays;
    logGroup?: logs.LogGroup;
    tracing?: lambda.Tracing;
    deadLetterQueueEnabled?: boolean;
    deadLetterQueue?: sqs.IQueue;
    permissions?: iam.PolicyStatement[];
    tags?: Record<string, string>;
}
export declare class LambdaFunctionBuilder {
    private props;
    private eventSources;
    private apiGatewayIntegrations;
    constructor(stack: cdk.Stack);
    setFunctionName(name: string): this;
    setDescription(description: string): this;
    setRuntime(runtime: lambda.Runtime): this;
    setHandler(handler: string): this;
    setCode(code: lambda.Code): this;
    setEnvironment(environment: Record<string, string>): this;
    setLayers(layers: lambda.ILayerVersion[]): this;
    setMemorySize(size: number): this;
    setTimeout(timeout: cdk.Duration): this;
    setReservedConcurrentExecutions(count: number): this;
    setRole(role: iam.Role): this;
    setLogRetention(retention: logs.RetentionDays): this;
    setLogGroup(logGroup: logs.LogGroup): this;
    setTracing(tracing: lambda.Tracing): this;
    setDeadLetterQueueEnabled(enabled: boolean): this;
    setDeadLetterQueue(queue: sqs.IQueue): this;
    addPermissions(permissions: iam.PolicyStatement[]): this;
    setTags(tags: Record<string, string>): this;
    addEventSource(rule: events.Rule): this;
    addApiGatewayIntegration(config: {
        api: apigateway.RestApi;
        method: string;
        path: string;
        authorizer?: apigateway.IAuthorizer;
    }): this;
    build(): lambda.Function;
}
export declare const createLambdaFunction: (stack: cdk.Stack, props?: Partial<LambdaFunctionProps>) => LambdaFunctionBuilder;
//# sourceMappingURL=lambda.d.ts.map