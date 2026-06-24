import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
export class MetricFilterAlarm extends Construct {
    metricFilter;
    alarm;
    constructor(scope, id, props) {
        super(scope, id);
        const evaluationPeriods = props.evaluationPeriods ?? 1;
        const period = props.metricPeriod ?? cdk.Duration.minutes(5);
        const statistic = props.metricStatistic ?? 'Sum';
        const comparisonOperator = props.comparisonOperator ?? cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD;
        const treatMissingData = props.treatMissingData ?? cloudwatch.TreatMissingData.NOT_BREACHING;
        this.metricFilter = new logs.MetricFilter(this, 'Filter', {
            logGroup: props.logGroup,
            filterPattern: logs.FilterPattern.literal(props.filterPattern),
            metricNamespace: props.metricNamespace,
            metricName: props.metricName,
            metricValue: props.metricValue ?? '1',
            defaultValue: props.defaultValue ?? 0,
        });
        this.alarm = new cloudwatch.Alarm(this, 'Alarm', {
            metric: this.metricFilter.metric({ statistic, period }),
            alarmName: props.alarmName,
            threshold: props.threshold,
            evaluationPeriods,
            comparisonOperator,
            treatMissingData,
        });
    }
}
//# sourceMappingURL=metricFilterAlarm.js.map