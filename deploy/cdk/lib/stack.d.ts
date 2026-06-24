import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EnvConfig } from './config';
export declare function createStack(scope: Construct, id: string, cfg: EnvConfig, props: cdk.StackProps): cdk.Stack;
