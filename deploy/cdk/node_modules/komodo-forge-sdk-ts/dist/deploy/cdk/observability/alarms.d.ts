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
export declare class AlarmBuilder {
    private props;
    constructor(stack: cdk.Stack);
    setAlarmName(name: string): this;
    setMetric(metric: cloudwatch.IMetric): this;
    setThreshold(threshold: number): this;
    setComparisonOperator(operator: cloudwatch.ComparisonOperator): this;
    setEvaluationPeriods(periods: number): this;
    setTreatMissingData(data: cloudwatch.TreatMissingData): this;
    setAlarmDescription(description: string): this;
    setActionsEnabled(enabled: boolean): this;
    addAlarmAction(topic: sns.ITopic): this;
    addAlarmActions(topics: sns.ITopic[]): this;
    addOkAction(topic: sns.ITopic): this;
    addOkActions(topics: sns.ITopic[]): this;
    addInsufficientDataAction(topic: sns.ITopic): this;
    addInsufficientDataActions(topics: sns.ITopic[]): this;
    setDatapointsToAlarm(count: number): this;
    setPeriod(period: cdk.Duration): this;
    build(): cloudwatch.Alarm;
}
export declare const createAlarm: (stack: cdk.Stack, metric: cloudwatch.IMetric, props?: Partial<AlarmProps>) => AlarmBuilder;
//# sourceMappingURL=alarms.d.ts.map