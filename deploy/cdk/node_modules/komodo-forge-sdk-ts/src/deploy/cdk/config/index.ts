import {
	DEFAULT_ACCOUNT_DEV,
	DEFAULT_ACCOUNT_PROD,
	DEFAULT_ACCOUNT_STAGING,
	DEFAULT_REGION_EAST,
	DEFAULT_REGION_WEST,
	ENV_DEV,
	ENV_PROD,
	ENV_STAGING,
} from '../constants.js';

export * from './validators.js';

export type Region = 'us-east-1' | 'us-east-2' | 'us-west-1' | 'us-west-2';
export interface RegionDeploy {
	region: Region;
	suffix: string;
	enabled: boolean;
}

export interface EnvConfig {
	name: string; // app/service name
	env: string; // environment (dev, stg, prod)
	account: string; // AWS account ID
	cpu: number; // 256, 512, 1024, etc.
	memory: number; // 512, 1024, 2048, etc.
	minCapacity: number; // minimum number of tasks
	maxCapacity: number; // maximum number of tasks
	secretPath?: string; // optional: path to secrets in AWS Secrets Manager
	downstreamUrls?: string[]; // optional: URLs of downstream services
	upstreamUrls?: string[]; // optional: URLs of upstream services
	vpcTag: string; // tag to identify VPC
	domainName: string; // domain name for the service
	certificateArn: string; // ARN of the SSL certificate
	cloudfrontEnabled?: boolean; // optional: enable CloudFront
	cloudFrontCertificateArn?: string; // optional: ARN of the CloudFront SSL certificate
	regions: RegionDeploy[]; // regions to deploy to
	tags?: Record<string, string>; // optional: tags to apply to resources
}

export const createEmptyConfig = (): EnvConfig => ({
	name: '',
	env: '',
	account: '',
	cpu: 0,
	memory: 0,
	minCapacity: 0,
	maxCapacity: 0,
	secretPath: '',
	vpcTag: '',
	domainName: '',
	certificateArn: '',
	regions: [],
	tags: {},
});

export const defaultDevConfig = (): EnvConfig => ({
	name: '',
	env: ENV_DEV,
	account: DEFAULT_ACCOUNT_DEV,
	cpu: 256,
	memory: 512,
	minCapacity: 1,
	maxCapacity: 2,
	downstreamUrls: [],
	upstreamUrls: [],
	vpcTag: '',
	domainName: '',
	certificateArn: '',
	regions: [{ region: DEFAULT_REGION_EAST, suffix: 'east', enabled: true }],
	tags: {
		owner: 'Komodo Future Solutions',
		managedBy: 'cdk',
		environment: ENV_DEV,
	},
});

export const defaultStgConfig = (): EnvConfig => ({
	name: '',
	env: ENV_STAGING,
	account: DEFAULT_ACCOUNT_STAGING,
	cpu: 512,
	memory: 1024,
	minCapacity: 1,
	maxCapacity: 3,
	downstreamUrls: [],
	upstreamUrls: [],
	vpcTag: '',
	domainName: '',
	certificateArn: '',
	cloudfrontEnabled: false,
	regions: [
		{ region: DEFAULT_REGION_EAST, suffix: 'east', enabled: true },
		{ region: DEFAULT_REGION_WEST, suffix: 'west', enabled: true },
	],
	tags: {
		owner: 'Komodo Future Solutions',
		managedBy: 'cdk',
		environment: ENV_STAGING,
	},
});

export const defaultProdConfig = (): EnvConfig => ({
	name: '',
	env: ENV_PROD,
	account: DEFAULT_ACCOUNT_PROD,
	cpu: 1024,
	memory: 2048,
	minCapacity: 1,
	maxCapacity: 6,
	downstreamUrls: [],
	upstreamUrls: [],
	vpcTag: '',
	domainName: '',
	certificateArn: '',
	regions: [
		{ region: DEFAULT_REGION_EAST, suffix: 'east', enabled: true },
		{ region: DEFAULT_REGION_WEST, suffix: 'west', enabled: true },
	],
	tags: {
		owner: 'Komodo Future Solutions',
		managedBy: 'cdk',
		environment: ENV_PROD,
	},
});

export const createRegionDeploy = (region: Region, suffix: string, enabled: boolean): RegionDeploy => ({ region, suffix, enabled });

export interface TagsConfig {
	project?: string;
	owner: 'Komodo Future Solutions' | string;
	environment?: typeof ENV_DEV | typeof ENV_STAGING | typeof ENV_PROD | string;
	costCenter?: string;
	managedBy: 'cdk' | 'terraform' | string;
	version?: string;
	tier?: 'standard' | 'high' | 'critical' | string;
	autoStart?: 'true' | 'false' | 'yes' | 'no';
	dataClassification?: 'public' | 'internal' | 'confidential' | 'pii' | 'restricted' | 'critical' | string;
}

export const createTags = (config?: TagsConfig): Record<string, string> => ({
	project: config?.project || '',
	owner: config?.owner || 'Komodo Future Solutions',
	environment: config?.environment || '',
	managedBy: config?.managedBy || 'cdk',
	costCenter: config?.costCenter || '',
	version: config?.version || '',
	tier: config?.tier || '',
	autoStart: config?.autoStart || 'true',
	dataClassification: config?.dataClassification || '',
});

export const defaultTags = (): Record<string, string> => ({
	owner: 'Komodo Future Solutions',
	managedBy: 'cdk',
});
