import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';

export interface AlarmProps {
	stack: cdk.Stack;
	alarmName?: string;
	metric: cloudwatch.IMetric;
	threshold: number;
	comparisonOperator: cloudwatch.ComparisonOperator;
	evaluationPeriods: number;
	treatMissingData?: cloudwatch.TreatMissingData;
	alarmDescription?: string;
	actionsEnabled?: boolean;
	alarmActions?: sns.ITopic[];
	okActions?: sns.ITopic[];
	insufficientDataActions?: sns.ITopic[];
	datapointsToAlarm?: number;
	period?: cdk.Duration;
}

export class AlarmBuilder {
	private props: Partial<AlarmProps> = {};

	constructor(stack: cdk.Stack) {
		this.props.stack = stack;
	}

	setAlarmName(name: string): this {
		this.props.alarmName = name;
		return this;
	}

	setMetric(metric: cloudwatch.IMetric): this {
		this.props.metric = metric;
		return this;
	}

	setThreshold(threshold: number): this {
		this.props.threshold = threshold;
		return this;
	}

	setComparisonOperator(operator: cloudwatch.ComparisonOperator): this {
		this.props.comparisonOperator = operator;
		return this;
	}

	setEvaluationPeriods(periods: number): this {
		this.props.evaluationPeriods = periods;
		return this;
	}

	setTreatMissingData(data: cloudwatch.TreatMissingData): this {
		this.props.treatMissingData = data;
		return this;
	}

	setAlarmDescription(description: string): this {
		this.props.alarmDescription = description;
		return this;
	}

	setActionsEnabled(enabled: boolean): this {
		this.props.actionsEnabled = enabled;
		return this;
	}

	addAlarmAction(topic: sns.ITopic): this {
		this.props.alarmActions = [...(this.props.alarmActions || []), topic];
		return this;
	}

	addAlarmActions(topics: sns.ITopic[]): this {
		this.props.alarmActions = [...(this.props.alarmActions || []), ...topics];
		return this;
	}

	addOkAction(topic: sns.ITopic): this {
		this.props.okActions = [...(this.props.okActions || []), topic];
		return this;
	}

	addOkActions(topics: sns.ITopic[]): this {
		this.props.okActions = [...(this.props.okActions || []), ...topics];
		return this;
	}

	addInsufficientDataAction(topic: sns.ITopic): this {
		this.props.insufficientDataActions = [...(this.props.insufficientDataActions || []), topic];
		return this;
	}

	addInsufficientDataActions(topics: sns.ITopic[]): this {
		this.props.insufficientDataActions = [...(this.props.insufficientDataActions || []), ...topics];
		return this;
	}

	setDatapointsToAlarm(count: number): this {
		this.props.datapointsToAlarm = count;
		return this;
	}

	setPeriod(period: cdk.Duration): this {
		this.props.period = period;
		return this;
	}

	build(): cloudwatch.Alarm {
		if (!this.props.stack || !this.props.metric) {
			throw new Error('stack and metric are required');
		}

		return new cloudwatch.Alarm(this.props.stack, this.props.alarmName || 'Alarm', {
			metric: this.props.metric,
			threshold: this.props.threshold || 0,
			comparisonOperator: this.props.comparisonOperator || cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			evaluationPeriods: this.props.evaluationPeriods || 1,
			...(this.props.treatMissingData && { treatMissingData: this.props.treatMissingData }),
			...(this.props.alarmDescription && { alarmDescription: this.props.alarmDescription }),
			...(this.props.actionsEnabled !== undefined && { actionsEnabled: this.props.actionsEnabled }),
			...(this.props.alarmActions && { alarmActions: this.props.alarmActions }),
			...(this.props.okActions && { okActions: this.props.okActions }),
			...(this.props.insufficientDataActions && { insufficientDataActions: this.props.insufficientDataActions }),
			...(this.props.datapointsToAlarm && { datapointsToAlarm: this.props.datapointsToAlarm }),
			...(this.props.period && { period: this.props.period }),
		});
	}
}

export const createAlarm = (
	stack: cdk.Stack,
	metric: cloudwatch.IMetric,
	props?: Partial<AlarmProps>,
): AlarmBuilder => {
	const builder = new AlarmBuilder(stack);
	builder.setMetric(metric);

	if (props) {
		if (props.alarmName) builder.setAlarmName(props.alarmName);
		if (props.threshold !== undefined) builder.setThreshold(props.threshold);
		if (props.comparisonOperator) builder.setComparisonOperator(props.comparisonOperator);
		if (props.evaluationPeriods !== undefined) builder.setEvaluationPeriods(props.evaluationPeriods);
		if (props.treatMissingData) builder.setTreatMissingData(props.treatMissingData);
		if (props.alarmDescription) builder.setAlarmDescription(props.alarmDescription);
		if (props.actionsEnabled !== undefined) builder.setActionsEnabled(props.actionsEnabled);
		if (props.alarmActions) builder.addAlarmActions(props.alarmActions);
		if (props.okActions) builder.addOkActions(props.okActions);
		if (props.insufficientDataActions) builder.addInsufficientDataActions(props.insufficientDataActions);
		if (props.datapointsToAlarm !== undefined) builder.setDatapointsToAlarm(props.datapointsToAlarm);
		if (props.period) builder.setPeriod(props.period);
	}
	return builder;
};
