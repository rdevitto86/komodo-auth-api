import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
export class AlarmBuilder {
    props = {};
    constructor(stack) {
        this.props.stack = stack;
    }
    setAlarmName(name) {
        this.props.alarmName = name;
        return this;
    }
    setMetric(metric) {
        this.props.metric = metric;
        return this;
    }
    setThreshold(threshold) {
        this.props.threshold = threshold;
        return this;
    }
    setComparisonOperator(operator) {
        this.props.comparisonOperator = operator;
        return this;
    }
    setEvaluationPeriods(periods) {
        this.props.evaluationPeriods = periods;
        return this;
    }
    setTreatMissingData(data) {
        this.props.treatMissingData = data;
        return this;
    }
    setAlarmDescription(description) {
        this.props.alarmDescription = description;
        return this;
    }
    setActionsEnabled(enabled) {
        this.props.actionsEnabled = enabled;
        return this;
    }
    addAlarmAction(topic) {
        this.props.alarmActions = [...(this.props.alarmActions || []), topic];
        return this;
    }
    addAlarmActions(topics) {
        this.props.alarmActions = [...(this.props.alarmActions || []), ...topics];
        return this;
    }
    addOkAction(topic) {
        this.props.okActions = [...(this.props.okActions || []), topic];
        return this;
    }
    addOkActions(topics) {
        this.props.okActions = [...(this.props.okActions || []), ...topics];
        return this;
    }
    addInsufficientDataAction(topic) {
        this.props.insufficientDataActions = [...(this.props.insufficientDataActions || []), topic];
        return this;
    }
    addInsufficientDataActions(topics) {
        this.props.insufficientDataActions = [...(this.props.insufficientDataActions || []), ...topics];
        return this;
    }
    setDatapointsToAlarm(count) {
        this.props.datapointsToAlarm = count;
        return this;
    }
    setPeriod(period) {
        this.props.period = period;
        return this;
    }
    build() {
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
export const createAlarm = (stack, metric, props) => {
    const builder = new AlarmBuilder(stack);
    builder.setMetric(metric);
    if (props) {
        if (props.alarmName)
            builder.setAlarmName(props.alarmName);
        if (props.threshold !== undefined)
            builder.setThreshold(props.threshold);
        if (props.comparisonOperator)
            builder.setComparisonOperator(props.comparisonOperator);
        if (props.evaluationPeriods !== undefined)
            builder.setEvaluationPeriods(props.evaluationPeriods);
        if (props.treatMissingData)
            builder.setTreatMissingData(props.treatMissingData);
        if (props.alarmDescription)
            builder.setAlarmDescription(props.alarmDescription);
        if (props.actionsEnabled !== undefined)
            builder.setActionsEnabled(props.actionsEnabled);
        if (props.alarmActions)
            builder.addAlarmActions(props.alarmActions);
        if (props.okActions)
            builder.addOkActions(props.okActions);
        if (props.insufficientDataActions)
            builder.addInsufficientDataActions(props.insufficientDataActions);
        if (props.datapointsToAlarm !== undefined)
            builder.setDatapointsToAlarm(props.datapointsToAlarm);
        if (props.period)
            builder.setPeriod(props.period);
    }
    return builder;
};
//# sourceMappingURL=alarms.js.map