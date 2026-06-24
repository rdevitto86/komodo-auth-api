import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
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

export class LambdaFunctionBuilder {
	private props: Partial<LambdaFunctionProps> = {};
	private eventSources: events.Rule[] = [];
	private apiGatewayIntegrations: Array<{
		api: apigateway.RestApi;
		method: string;
		path: string;
		authorizer?: apigateway.IAuthorizer;
	}> = [];

	constructor(stack: cdk.Stack) {
		this.props.stack = stack;
	}

	setFunctionName(name: string): this {
		this.props.functionName = name;
		return this;
	}

	setDescription(description: string): this {
		this.props.description = description;
		return this;
	}

	setRuntime(runtime: lambda.Runtime): this {
		this.props.runtime = runtime;
		return this;
	}

	setHandler(handler: string): this {
		this.props.handler = handler;
		return this;
	}

	setCode(code: lambda.Code): this {
		this.props.code = code;
		return this;
	}

	setEnvironment(environment: Record<string, string>): this {
		this.props.environment = environment;
		return this;
	}

	setLayers(layers: lambda.ILayerVersion[]): this {
		this.props.layers = layers;
		return this;
	}

	setMemorySize(size: number): this {
		this.props.memorySize = size;
		return this;
	}

	setTimeout(timeout: cdk.Duration): this {
		this.props.timeout = timeout;
		return this;
	}

	setReservedConcurrentExecutions(count: number): this {
		this.props.reservedConcurrentExecutions = count;
		return this;
	}

	setRole(role: iam.Role): this {
		this.props.role = role;
		return this;
	}

	setLogRetention(retention: logs.RetentionDays): this {
		this.props.logRetention = retention;
		return this;
	}

	setLogGroup(logGroup: logs.LogGroup): this {
		this.props.logGroup = logGroup;
		return this;
	}

	setTracing(tracing: lambda.Tracing): this {
		this.props.tracing = tracing;
		return this;
	}

	setDeadLetterQueueEnabled(enabled: boolean): this {
		this.props.deadLetterQueueEnabled = enabled;
		return this;
	}

	setDeadLetterQueue(queue: sqs.IQueue): this {
		this.props.deadLetterQueue = queue;
		return this;
	}

	addPermissions(permissions: iam.PolicyStatement[]): this {
		this.props.permissions = [...(this.props.permissions || []), ...permissions];
		return this;
	}

	setTags(tags: Record<string, string>): this {
		this.props.tags = tags;
		return this;
	}

	addEventSource(rule: events.Rule): this {
		this.eventSources.push(rule);
		return this;
	}

	addApiGatewayIntegration(config: {
		api: apigateway.RestApi;
		method: string;
		path: string;
		authorizer?: apigateway.IAuthorizer;
	}): this {
		this.apiGatewayIntegrations.push(config);
		return this;
	}

	build(): lambda.Function {
		if (!this.props.stack) {
			throw new Error('stack is required');
		}

		const functionProps: lambda.FunctionProps = {
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

		const lambdaFunction = new lambda.Function(
			this.props.stack,
			this.props.functionName || 'LambdaFunction',
			functionProps,
		);

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
			const resource =
				integration.api.root.resourceForPath(integration.path) || integration.api.root.addResource(integration.path);
			resource.addMethod(integration.method, lambdaIntegration, {
				...(integration.authorizer && { authorizer: integration.authorizer }),
			});
		}
		return lambdaFunction;
	}
}

export const createLambdaFunction = (stack: cdk.Stack, props?: Partial<LambdaFunctionProps>): LambdaFunctionBuilder => {
	const builder = new LambdaFunctionBuilder(stack);
	if (props) Object.assign(builder['props'], props);
	return builder;
};
