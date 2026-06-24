import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlarmBuilder, type AlarmProps, createAlarm } from './alarms.js';
import { createLogGroup, LogGroupBuilder, type LogGroupProps } from './logs.js';

describe('observability/alarms', () => {
	describe('AlarmBuilder', () => {
		let mockStack: cdk.Stack;
		let mockMetric: cloudwatch.IMetric;

		beforeEach(() => {
			mockStack = new cdk.Stack();
			mockMetric = new cloudwatch.Metric({
				namespace: 'TestNamespace',
				metricName: 'TestMetric',
				statistic: 'Average',
				period: cdk.Duration.seconds(300),
			});
		});

		it('should create builder with stack', () => {
			const builder = new AlarmBuilder(mockStack);
			expect(builder).toBeInstanceOf(AlarmBuilder);
		});

		it('should set alarm name', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setAlarmName('test-alarm');
			expect(result).toBe(builder);
		});

		it('should set metric', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setMetric(mockMetric);
			expect(result).toBe(builder);
		});

		it('should set threshold', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setThreshold(80);
			expect(result).toBe(builder);
		});

		it('should set comparison operator', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setComparisonOperator(cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD);
			expect(result).toBe(builder);
		});

		it('should set evaluation periods', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setEvaluationPeriods(5);
			expect(result).toBe(builder);
		});

		it('should set treat missing data', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setTreatMissingData(cloudwatch.TreatMissingData.NOT_BREACHING);
			expect(result).toBe(builder);
		});

		it('should set alarm description', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setAlarmDescription('Test alarm description');
			expect(result).toBe(builder);
		});

		it('should set actions enabled', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setActionsEnabled(true);
			expect(result).toBe(builder);
		});

		it('should add alarm action', () => {
			const builder = new AlarmBuilder(mockStack);
			const topic = new sns.Topic(mockStack, 'TestTopic');
			const result = builder.addAlarmAction(topic);
			expect(result).toBe(builder);
		});

		it('should add alarm actions', () => {
			const builder = new AlarmBuilder(mockStack);
			const topic1 = new sns.Topic(mockStack, 'TestTopic1');
			const topic2 = new sns.Topic(mockStack, 'TestTopic2');
			const result = builder.addAlarmActions([topic1, topic2]);
			expect(result).toBe(builder);
		});

		it('should add ok action', () => {
			const builder = new AlarmBuilder(mockStack);
			const topic = new sns.Topic(mockStack, 'TestTopic');
			const result = builder.addOkAction(topic);
			expect(result).toBe(builder);
		});

		it('should add ok actions', () => {
			const builder = new AlarmBuilder(mockStack);
			const topic1 = new sns.Topic(mockStack, 'TestTopic1');
			const topic2 = new sns.Topic(mockStack, 'TestTopic2');
			const result = builder.addOkActions([topic1, topic2]);
			expect(result).toBe(builder);
		});

		it('should add insufficient data action', () => {
			const builder = new AlarmBuilder(mockStack);
			const topic = new sns.Topic(mockStack, 'TestTopic');
			const result = builder.addInsufficientDataAction(topic);
			expect(result).toBe(builder);
		});

		it('should add insufficient data actions', () => {
			const builder = new AlarmBuilder(mockStack);
			const topic1 = new sns.Topic(mockStack, 'TestTopic1');
			const topic2 = new sns.Topic(mockStack, 'TestTopic2');
			const result = builder.addInsufficientDataActions([topic1, topic2]);
			expect(result).toBe(builder);
		});

		it('should set datapoints to alarm', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setDatapointsToAlarm(3);
			expect(result).toBe(builder);
		});

		it('should set period', () => {
			const builder = new AlarmBuilder(mockStack);
			const result = builder.setPeriod(cdk.Duration.seconds(300));
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new AlarmBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack and metric are required');
		});

		it('should throw error when building without metric', () => {
			const builder = new AlarmBuilder(mockStack);
			expect(() => builder.build()).toThrow('stack and metric are required');
		});

		it('should build alarm with defaults', () => {
			const builder = new AlarmBuilder(mockStack).setMetric(mockMetric);
			const alarm = builder.build();
			expect(alarm).toBeInstanceOf(cloudwatch.Alarm);
		});

		it('should build alarm with custom values', () => {
			const builder = new AlarmBuilder(mockStack)
				.setAlarmName('custom-alarm')
				.setMetric(mockMetric)
				.setThreshold(90)
				.setComparisonOperator(cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD)
				.setEvaluationPeriods(3)
				.setAlarmDescription('Custom alarm description');
			const alarm = builder.build();
			expect(alarm).toBeInstanceOf(cloudwatch.Alarm);
		});
	});

	describe('createAlarm', () => {
		it('should create builder with stack and metric', () => {
			const mockStack = new cdk.Stack();
			const mockMetric = new cloudwatch.Metric({
				namespace: 'TestNamespace',
				metricName: 'TestMetric',
				statistic: 'Average',
				period: cdk.Duration.seconds(300),
			});
			const builder = createAlarm(mockStack, mockMetric);
			expect(builder).toBeInstanceOf(AlarmBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const mockMetric = new cloudwatch.Metric({
				namespace: 'TestNamespace',
				metricName: 'TestMetric',
				statistic: 'Average',
				period: cdk.Duration.seconds(300),
			});
			const props: Partial<AlarmProps> = {
				alarmName: 'test-alarm',
				threshold: 80,
				evaluationPeriods: 5,
			};
			const builder = createAlarm(mockStack, mockMetric, props);
			expect(builder).toBeInstanceOf(AlarmBuilder);
		});
	});
});

describe('observability/logs', () => {
	describe('LogGroupBuilder', () => {
		let mockStack: cdk.Stack;

		beforeEach(() => {
			mockStack = new cdk.Stack();
		});

		it('should create builder with stack', () => {
			const builder = new LogGroupBuilder(mockStack);
			expect(builder).toBeInstanceOf(LogGroupBuilder);
		});

		it('should set log group name', () => {
			const builder = new LogGroupBuilder(mockStack);
			const result = builder.setLogGroupName('test-log-group');
			expect(result).toBe(builder);
		});

		it('should set retention', () => {
			const builder = new LogGroupBuilder(mockStack);
			const result = builder.setRetention(logs.RetentionDays.ONE_MONTH);
			expect(result).toBe(builder);
		});

		it('should set removal policy', () => {
			const builder = new LogGroupBuilder(mockStack);
			const result = builder.setRemovalPolicy(cdk.RemovalPolicy.DESTROY);
			expect(result).toBe(builder);
		});

		it('should set encryption key', () => {
			const builder = new LogGroupBuilder(mockStack);
			const key = new kms.Key(mockStack, 'TestKey');
			const result = builder.setEncryptionKey(key);
			expect(result).toBe(builder);
		});

		it('should set tags', () => {
			const builder = new LogGroupBuilder(mockStack);
			const tags = { Environment: 'dev' };
			const result = builder.setTags(tags);
			expect(result).toBe(builder);
		});

		it('should throw error when building without stack', () => {
			const builder = new LogGroupBuilder(mockStack);
			builder['props'].stack = undefined as any;
			expect(() => builder.build()).toThrow('stack is required');
		});

		it('should build log group with defaults', () => {
			const builder = new LogGroupBuilder(mockStack);
			const logGroup = builder.build();
			expect(logGroup).toBeInstanceOf(logs.LogGroup);
		});

		it('should build log group with custom values', () => {
			const builder = new LogGroupBuilder(mockStack)
				.setLogGroupName('custom-log-group')
				.setRetention(logs.RetentionDays.ONE_MONTH)
				.setRemovalPolicy(cdk.RemovalPolicy.DESTROY)
				.setTags({ Environment: 'test' });
			const logGroup = builder.build();
			expect(logGroup).toBeInstanceOf(logs.LogGroup);
		});

		it('should build log group with encryption key', () => {
			const builder = new LogGroupBuilder(mockStack);
			const key = new kms.Key(mockStack, 'TestKey');
			builder.setEncryptionKey(key);
			const logGroup = builder.build();
			expect(logGroup).toBeInstanceOf(logs.LogGroup);
		});
	});

	describe('createLogGroup', () => {
		it('should create builder with stack', () => {
			const mockStack = new cdk.Stack();
			const builder = createLogGroup(mockStack);
			expect(builder).toBeInstanceOf(LogGroupBuilder);
		});

		it('should create builder with props', () => {
			const mockStack = new cdk.Stack();
			const props: Partial<LogGroupProps> = {
				logGroupName: 'test-log-group',
				retention: logs.RetentionDays.ONE_MONTH,
			};
			const builder = createLogGroup(mockStack, props);
			expect(builder).toBeInstanceOf(LogGroupBuilder);
		});
	});
});
