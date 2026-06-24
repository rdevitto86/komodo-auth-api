import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
export class LambdaFunctionBuilder {
    props = {};
    eventSources = [];
    apiGatewayIntegrations = [];
    constructor(stack) {
        this.props.stack = stack;
    }
    setFunctionName(name) {
        this.props.functionName = name;
        return this;
    }
    setDescription(description) {
        this.props.description = description;
        return this;
    }
    setRuntime(runtime) {
        this.props.runtime = runtime;
        return this;
    }
    setHandler(handler) {
        this.props.handler = handler;
        return this;
    }
    setCode(code) {
        this.props.code = code;
        return this;
    }
    setEnvironment(environment) {
        this.props.environment = environment;
        return this;
    }
    setLayers(layers) {
        this.props.layers = layers;
        return this;
    }
    setMemorySize(size) {
        this.props.memorySize = size;
        return this;
    }
    setTimeout(timeout) {
        this.props.timeout = timeout;
        return this;
    }
    setReservedConcurrentExecutions(count) {
        this.props.reservedConcurrentExecutions = count;
        return this;
    }
    setRole(role) {
        this.props.role = role;
        return this;
    }
    setLogRetention(retention) {
        this.props.logRetention = retention;
        return this;
    }
    setLogGroup(logGroup) {
        this.props.logGroup = logGroup;
        return this;
    }
    setTracing(tracing) {
        this.props.tracing = tracing;
        return this;
    }
    setDeadLetterQueueEnabled(enabled) {
        this.props.deadLetterQueueEnabled = enabled;
        return this;
    }
    setDeadLetterQueue(queue) {
        this.props.deadLetterQueue = queue;
        return this;
    }
    addPermissions(permissions) {
        this.props.permissions = [...(this.props.permissions || []), ...permissions];
        return this;
    }
    setTags(tags) {
        this.props.tags = tags;
        return this;
    }
    addEventSource(rule) {
        this.eventSources.push(rule);
        return this;
    }
    addApiGatewayIntegration(config) {
        this.apiGatewayIntegrations.push(config);
        return this;
    }
    build() {
        if (!this.props.stack) {
            throw new Error('stack is required');
        }
        const functionProps = {
            runtime: this.props.runtime || lambda.Runtime.NODEJS_20_X,
            handler: this.props.handler || 'index.handler',
            code: this.props.code || lambda.Code.fromAsset('lambda'),
            memorySize: this.props.memorySize || 128,
            timeout: this.props.timeout || cdk.Duration.seconds(30),
            logRetention: this.props.logRetention || logs.RetentionDays.ONE_WEEK,
            tracing: this.props.tracing || lambda.Tracing.ACTIVE,
            ...(this.props.description && { description: this.props.description }),
            ...(this.props.environment && { environment: this.props.environment }),
            ...(this.props.layers && { layers: this.props.layers }),
            ...(this.props.reservedConcurrentExecutions !== undefined && {
                reservedConcurrentExecutions: this.props.reservedConcurrentExecutions,
            }),
            ...(this.props.role && { role: this.props.role }),
            ...(this.props.logGroup && { logGroup: this.props.logGroup }),
            ...(this.props.deadLetterQueue && { deadLetterQueue: this.props.deadLetterQueue }),
            ...(this.props.deadLetterQueueEnabled && { deadLetterQueueEnabled: true }),
        };
        const lambdaFunction = new lambda.Function(this.props.stack, this.props.functionName || 'LambdaFunction', functionProps);
        if (this.props.permissions) {
            for (const permission of this.props.permissions) {
                lambdaFunction.addToRolePolicy(permission);
            }
        }
        if (this.props.tags) {
            Object.entries(this.props.tags).forEach(([key, value]) => {
                cdk.Tags.of(lambdaFunction).add(key, value);
            });
        }
        for (const eventSource of this.eventSources) {
            eventSource.addTarget(new targets.LambdaFunction(lambdaFunction));
        }
        for (const integration of this.apiGatewayIntegrations) {
            const lambdaIntegration = new apigateway.LambdaIntegration(lambdaFunction);
            const resource = integration.api.root.resourceForPath(integration.path) || integration.api.root.addResource(integration.path);
            resource.addMethod(integration.method, lambdaIntegration, {
                ...(integration.authorizer && { authorizer: integration.authorizer }),
            });
        }
        return lambdaFunction;
    }
}
export const createLambdaFunction = (stack, props) => {
    const builder = new LambdaFunctionBuilder(stack);
    if (props)
        Object.assign(builder['props'], props);
    return builder;
};
//# sourceMappingURL=lambda.js.map