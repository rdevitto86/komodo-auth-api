import { ENV_DEV, ENV_STAGING, ENV_PROD } from '../constants.js';
import type { EnvConfig, RegionDeploy } from './index.js';

export const isValidARN = (arn: string): boolean => arn.startsWith('arn:');
export const isValidDomain = (domain: string): boolean => domain === 'komodo.com' || domain.endsWith('.komodo.com');
export const isValidCpu = (cpu: number): boolean => cpu >= 256 && cpu <= 3072;
export const isValidMemory = (memory: number): boolean => memory >= 512 && memory <= 6144;
export const isValidCapacity = (capacity: number): boolean => capacity >= 1 && capacity <= 10;
export const isValidEnvironment = (environment: string): boolean =>
	environment === ENV_DEV || environment === ENV_STAGING || environment === ENV_PROD;
export const isValidVersion = (version: string): boolean => /^\d+\.\d+\.\d+$/.test(version);
export const isValidRegion = (region: string): boolean =>
	region === 'us-east-1' || region === 'us-east-2' || region === 'us-west-1' || region === 'us-west-2';
export const isValidRegionDeploy = (regionDeploy: RegionDeploy): boolean =>
	isValidRegion(regionDeploy.region) &&
	typeof regionDeploy.suffix === 'string' &&
	typeof regionDeploy.enabled === 'boolean';
export const isValidAccount = (account: string): boolean => /^\d{12}$/.test(account);
export const isValidTags = (tags: Record<string, string>): boolean =>
	typeof tags.owner === 'string' &&
	tags.owner.length > 0 &&
	typeof tags.managedBy === 'string' &&
	tags.managedBy.length > 0;
export const isValidUpstreamDownstreamUrl = (url: string): boolean =>
	(url.startsWith('http://') || url.startsWith('https://')) && url.includes('komodo');

export const validateConfig = (config: EnvConfig): boolean => {
	if (!config) return false;
	if (config.tags && !isValidTags(config.tags)) return false;
	if (config.upstreamUrls && !config.upstreamUrls.every(isValidUpstreamDownstreamUrl)) return false;
	if (config.downstreamUrls && !config.downstreamUrls.every(isValidUpstreamDownstreamUrl)) return false;

	if (!config.name || config.name.length === 0) return false;

	return (
		isValidARN(config.certificateArn) &&
		isValidDomain(config.domainName) &&
		isValidCpu(config.cpu) &&
		isValidMemory(config.memory) &&
		isValidCapacity(config.minCapacity) &&
		isValidCapacity(config.maxCapacity) &&
		isValidEnvironment(config.env) &&
		config.regions.every(isValidRegionDeploy) &&
		isValidAccount(config.account)
	);
};
