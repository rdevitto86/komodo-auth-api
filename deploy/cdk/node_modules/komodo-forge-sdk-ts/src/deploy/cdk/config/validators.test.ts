import { describe, expect, it } from 'vitest';
import type { EnvConfig, RegionDeploy } from './index.js';
import {
	isValidARN,
	isValidAccount,
	isValidCapacity,
	isValidCpu,
	isValidDomain,
	isValidEnvironment,
	isValidMemory,
	isValidRegion,
	isValidRegionDeploy,
	isValidTags,
	isValidUpstreamDownstreamUrl,
	isValidVersion,
	validateConfig,
} from './validators.js';

const validConfig: EnvConfig = {
	name: 'komodo-auth-api',
	env: 'dev',
	account: '123456789012',
	cpu: 256,
	memory: 512,
	minCapacity: 1,
	maxCapacity: 2,
	vpcTag: 'komodo-dev',
	domainName: 'auth-dev.komodo.com',
	certificateArn: 'arn:aws:acm:us-east-2:123456789012:certificate/abc-123',
	regions: [{ region: 'us-east-2', suffix: 'east', enabled: true }],
	tags: { owner: 'Komodo Future Solutions', managedBy: 'cdk' },
};

const configWith = (overrides: Partial<EnvConfig>): EnvConfig => ({
	...validConfig,
	...overrides,
});

// ── Unit Tests ──────────────────────────────────────────────────────────

describe('isValidARN', () => {
	it('accepts a valid ARN', () => {
		expect(isValidARN('arn:aws:acm:us-east-2:123456789012:certificate/abc')).toBe(true);
	});

	it('rejects an empty string', () => {
		expect(isValidARN('')).toBe(false);
	});

	it('rejects a non-ARN string', () => {
		expect(isValidARN('not-an-arn')).toBe(false);
	});
});

describe('isValidDomain', () => {
	it('accepts auth.komodo.com', () => {
		expect(isValidDomain('auth.komodo.com')).toBe(true);
	});

	it('accepts auth-dev.komodo.com', () => {
		expect(isValidDomain('auth-dev.komodo.com')).toBe(true);
	});

	it('accepts auth-stg.komodo.com', () => {
		expect(isValidDomain('auth-stg.komodo.com')).toBe(true);
	});

	it('accepts komodo.com bare', () => {
		expect(isValidDomain('komodo.com')).toBe(true);
	});

	it('rejects notkomodo.com', () => {
		expect(isValidDomain('notkomodo.com')).toBe(false);
	});

	it('rejects an empty string', () => {
		expect(isValidDomain('')).toBe(false);
	});

	it('rejects a domain that only contains komodo.com as substring', () => {
		expect(isValidDomain('fakekomodo.com')).toBe(false);
	});
});

describe('isValidCpu', () => {
	it('accepts lower boundary 256', () => {
		expect(isValidCpu(256)).toBe(true);
	});

	it('accepts 512', () => {
		expect(isValidCpu(512)).toBe(true);
	});

	it('accepts 1024', () => {
		expect(isValidCpu(1024)).toBe(true);
	});

	it('accepts upper boundary 3072', () => {
		expect(isValidCpu(3072)).toBe(true);
	});

	it('rejects 0', () => {
		expect(isValidCpu(0)).toBe(false);
	});

	it('rejects 255', () => {
		expect(isValidCpu(255)).toBe(false);
	});

	it('rejects 3073', () => {
		expect(isValidCpu(3073)).toBe(false);
	});

	it('rejects negative values', () => {
		expect(isValidCpu(-1)).toBe(false);
	});
});

describe('isValidMemory', () => {
	it('accepts lower boundary 512', () => {
		expect(isValidMemory(512)).toBe(true);
	});

	it('accepts 1024', () => {
		expect(isValidMemory(1024)).toBe(true);
	});

	it('accepts 2048', () => {
		expect(isValidMemory(2048)).toBe(true);
	});

	it('accepts upper boundary 6144', () => {
		expect(isValidMemory(6144)).toBe(true);
	});

	it('rejects 0', () => {
		expect(isValidMemory(0)).toBe(false);
	});

	it('rejects 511', () => {
		expect(isValidMemory(511)).toBe(false);
	});

	it('rejects 6145', () => {
		expect(isValidMemory(6145)).toBe(false);
	});
});

describe('isValidCapacity', () => {
	it('accepts lower boundary 1', () => {
		expect(isValidCapacity(1)).toBe(true);
	});

	it('accepts mid-range 5', () => {
		expect(isValidCapacity(5)).toBe(true);
	});

	it('accepts upper boundary 10', () => {
		expect(isValidCapacity(10)).toBe(true);
	});

	it('rejects 0', () => {
		expect(isValidCapacity(0)).toBe(false);
	});

	it('rejects 11', () => {
		expect(isValidCapacity(11)).toBe(false);
	});

	it('rejects negative values', () => {
		expect(isValidCapacity(-1)).toBe(false);
	});
});

describe('isValidEnvironment', () => {
	it('accepts dev', () => {
		expect(isValidEnvironment('dev')).toBe(true);
	});

	it('accepts staging', () => {
		expect(isValidEnvironment('staging')).toBe(true);
	});

	it('accepts prod', () => {
		expect(isValidEnvironment('prod')).toBe(true);
	});

	it('rejects stg (constant is staging)', () => {
		expect(isValidEnvironment('stg')).toBe(false);
	});

	it('rejects local', () => {
		expect(isValidEnvironment('local')).toBe(false);
	});

	it('rejects empty string', () => {
		expect(isValidEnvironment('')).toBe(false);
	});
});

describe('isValidVersion', () => {
	it('accepts 1.0.0', () => {
		expect(isValidVersion('1.0.0')).toBe(true);
	});

	it('accepts 0.3.3', () => {
		expect(isValidVersion('0.3.3')).toBe(true);
	});

	it('accepts 10.20.30', () => {
		expect(isValidVersion('10.20.30')).toBe(true);
	});

	it('rejects v1.0.0 with prefix', () => {
		expect(isValidVersion('v1.0.0')).toBe(false);
	});

	it('rejects 1.0 with only two segments', () => {
		expect(isValidVersion('1.0')).toBe(false);
	});

	it('rejects 1.0.0.0 with four segments', () => {
		expect(isValidVersion('1.0.0.0')).toBe(false);
	});
});

describe('isValidRegion', () => {
	it('accepts us-east-1', () => {
		expect(isValidRegion('us-east-1')).toBe(true);
	});

	it('accepts us-east-2', () => {
		expect(isValidRegion('us-east-2')).toBe(true);
	});

	it('accepts us-west-1', () => {
		expect(isValidRegion('us-west-1')).toBe(true);
	});

	it('accepts us-west-2', () => {
		expect(isValidRegion('us-west-2')).toBe(true);
	});

	it('rejects eu-west-1', () => {
		expect(isValidRegion('eu-west-1')).toBe(false);
	});

	it('rejects empty string', () => {
		expect(isValidRegion('')).toBe(false);
	});
});

describe('isValidRegionDeploy', () => {
	it('accepts a valid region deploy', () => {
		const deploy: RegionDeploy = { region: 'us-east-2', suffix: 'east', enabled: true };
		expect(isValidRegionDeploy(deploy)).toBe(true);
	});

	it('rejects an invalid region', () => {
		const deploy = { region: 'eu-west-1', suffix: 'west', enabled: true } as unknown as RegionDeploy;
		expect(isValidRegionDeploy(deploy)).toBe(false);
	});

	it('rejects missing suffix', () => {
		const deploy = { region: 'us-east-2', enabled: true } as unknown as RegionDeploy;
		expect(isValidRegionDeploy(deploy)).toBe(false);
	});

	it('rejects missing enabled', () => {
		const deploy = { region: 'us-east-2', suffix: 'east' } as unknown as RegionDeploy;
		expect(isValidRegionDeploy(deploy)).toBe(false);
	});
});

describe('isValidAccount', () => {
	it('accepts a 12-digit string', () => {
		expect(isValidAccount('123456789012')).toBe(true);
	});

	it('rejects an 11-digit string', () => {
		expect(isValidAccount('12345678901')).toBe(false);
	});

	it('rejects a 13-digit string', () => {
		expect(isValidAccount('1234567890123')).toBe(false);
	});

	it('rejects letters', () => {
		expect(isValidAccount('12345678901a')).toBe(false);
	});

	it('rejects empty string', () => {
		expect(isValidAccount('')).toBe(false);
	});
});

describe('isValidTags', () => {
	it('accepts tags with required keys non-empty', () => {
		expect(isValidTags({ owner: 'Komodo Future Solutions', managedBy: 'cdk' })).toBe(true);
	});

	it('rejects tags with empty owner', () => {
		expect(isValidTags({ owner: '', managedBy: 'cdk' })).toBe(false);
	});

	it('rejects tags with empty managedBy', () => {
		expect(isValidTags({ owner: 'Komodo Future Solutions', managedBy: '' })).toBe(false);
	});

	it('rejects tags missing owner key', () => {
		expect(isValidTags({ managedBy: 'cdk' })).toBe(false);
	});

	it('rejects tags missing managedBy key', () => {
		expect(isValidTags({ owner: 'Komodo Future Solutions' })).toBe(false);
	});

	it('accepts tags with extra empty optional keys', () => {
		expect(isValidTags({ owner: 'Komodo Future Solutions', managedBy: 'cdk', project: '', costCenter: '' })).toBe(true);
	});

	it('accepts tags from createTags with defaults', () => {
		expect(
			isValidTags({
				project: '',
				owner: 'Komodo Future Solutions',
				environment: '',
				managedBy: 'cdk',
				costCenter: '',
				version: '',
				tier: '',
				autoStart: 'true',
				dataClassification: '',
			}),
		).toBe(true);
	});
});

describe('isValidUpstreamDownstreamUrl', () => {
	it('accepts https URL with komodo', () => {
		expect(isValidUpstreamDownstreamUrl('https://auth.komodo.com')).toBe(true);
	});

	it('accepts http URL with komodo', () => {
		expect(isValidUpstreamDownstreamUrl('http://api.komodo.internal')).toBe(true);
	});

	it('rejects URL missing protocol', () => {
		expect(isValidUpstreamDownstreamUrl('api.komodo.com')).toBe(false);
	});

	it('rejects URL missing komodo', () => {
		expect(isValidUpstreamDownstreamUrl('https://example.com')).toBe(false);
	});

	it('rejects empty string', () => {
		expect(isValidUpstreamDownstreamUrl('')).toBe(false);
	});
});

describe('validateConfig', () => {
	it('accepts a fully valid config', () => {
		expect(validateConfig(validConfig)).toBe(true);
	});

	it('rejects null config', () => {
		expect(validateConfig(null as unknown as EnvConfig)).toBe(false);
	});

	it('rejects empty name', () => {
		expect(validateConfig(configWith({ name: '' }))).toBe(false);
	});

	it('rejects invalid certificateArn', () => {
		expect(validateConfig(configWith({ certificateArn: 'not-an-arn' }))).toBe(false);
	});

	it('rejects invalid domainName', () => {
		expect(validateConfig(configWith({ domainName: 'notkomodo.com' }))).toBe(false);
	});

	it('rejects invalid cpu', () => {
		expect(validateConfig(configWith({ cpu: 0 }))).toBe(false);
	});

	it('rejects invalid memory', () => {
		expect(validateConfig(configWith({ memory: 0 }))).toBe(false);
	});

	it('rejects invalid minCapacity', () => {
		expect(validateConfig(configWith({ minCapacity: 0 }))).toBe(false);
	});

	it('rejects invalid maxCapacity', () => {
		expect(validateConfig(configWith({ maxCapacity: 11 }))).toBe(false);
	});

	it('rejects invalid env', () => {
		expect(validateConfig(configWith({ env: 'local' }))).toBe(false);
	});

	it('rejects invalid account', () => {
		expect(validateConfig(configWith({ account: '12345' }))).toBe(false);
	});

	it('rejects invalid region in regions array', () => {
		expect(
			validateConfig(
				configWith({
					regions: [{ region: 'eu-west-1' as 'us-east-1', suffix: 'west', enabled: true }],
				}),
			),
		).toBe(false);
	});

	it('rejects invalid tags', () => {
		expect(validateConfig(configWith({ tags: { owner: '', managedBy: 'cdk' } }))).toBe(false);
	});

	it('rejects invalid upstream URLs', () => {
		expect(validateConfig(configWith({ upstreamUrls: ['bad-url'] }))).toBe(false);
	});

	it('rejects invalid downstream URLs', () => {
		expect(validateConfig(configWith({ downstreamUrls: ['bad-url'] }))).toBe(false);
	});

	it('accepts config without optional tags', () => {
		const { tags: _tags, ...rest } = validConfig;
		expect(validateConfig(rest as EnvConfig)).toBe(true);
	});

	it('accepts config without optional upstream/downstream URLs', () => {
		const { upstreamUrls: _up, downstreamUrls: _down, ...rest } = validConfig;
		expect(validateConfig(rest as EnvConfig)).toBe(true);
	});

	it('accepts valid upstream and downstream URLs', () => {
		expect(
			validateConfig(
				configWith({
					upstreamUrls: ['https://user.komodo.com'],
					downstreamUrls: ['https://comms.komodo.com'],
				}),
			),
		).toBe(true);
	});

	it('accepts config with tags from createTags defaults', () => {
		expect(
			validateConfig(
				configWith({
					tags: {
						project: '',
						owner: 'Komodo Future Solutions',
						environment: '',
						managedBy: 'cdk',
						costCenter: '',
						version: '',
						tier: '',
						autoStart: 'true',
						dataClassification: '',
					},
				}),
			),
		).toBe(true);
	});
});
