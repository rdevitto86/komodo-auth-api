import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
export interface MetricFilterAlarmProps {
    logGroup: logs.ILogGroup;
    filterPattern: string;
    metricNamespace: string;
    metricName: string;
    alarmName: string;
    threshold: number;
    evaluationPeriods?: number;
    metricPeriod?: cdk.Duration;
    metricStatistic?: string;
    comparisonOperator?: cloudwatch.ComparisonOperator;
    treatMissingData?: cloudwatch.TreatMissingData;
    metricValue?: string;
    defaultValue?: number;
}
export declare class MetricFilterAlarm extends Construct {
    readonly metricFilter: logs.MetricFilter;
    readonly alarm: cloudwatch.Alarm;
    constructor(scope: Construct, id: string, props: MetricFilterAlarmProps);
}
//# sourceMappingURL=metricFilterAlarm.d.ts.map