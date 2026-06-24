import { describe, expect, it } from 'vitest';
import {
	createEmptyConfig,
	createTags,
	defaultDevConfig,
	defaultProdConfig,
	defaultStgConfig,
	defaultTags,
} from './index.js';

describe('config/index', () => {
	describe('createEmptyConfig', () => {
		it('should create an empty config with default values', () => {
			const config = createEmptyConfig();
			expect(config).toEqual({
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
		});
	});

	describe('defaultDevConfig', () => {
		it('should create default dev config', () => {
			const config = defaultDevConfig();
			expect(config.name).toBe('');
			expect(config.env).toBe('dev');
			expect(config.account).toBe('123456789012');
			expect(config.cpu).toBe(256);
			expect(config.memory).toBe(512);
			expect(config.minCapacity).toBe(1);
			expect(config.maxCapacity).toBe(2);
			expect(config.downstreamUrls).toEqual([]);
			expect(config.upstreamUrls).toEqual([]);
			expect(config.vpcTag).toBe('');
			expect(config.domainName).toBe('');
			expect(config.certificateArn).toBe('');
			expect(config.regions).toEqual([{ region: 'us-east-2', suffix: 'east', enabled: true }]);
			expect(config.tags).toEqual({ owner: 'Komodo Future Solutions', managedBy: 'cdk', environment: 'dev' });
		});
	});

	describe('defaultStgConfig', () => {
		it('should create default staging config', () => {
			const config = defaultStgConfig();
			expect(config.name).toBe('');
			expect(config.env).toBe('staging');
			expect(config.account).toBe('123456789012');
			expect(config.cpu).toBe(512);
			expect(config.memory).toBe(1024);
			expect(config.minCapacity).toBe(1);
			expect(config.maxCapacity).toBe(3);
			expect(config.downstreamUrls).toEqual([]);
			expect(config.upstreamUrls).toEqual([]);
			expect(config.vpcTag).toBe('');
			expect(config.domainName).toBe('');
			expect(config.certificateArn).toBe('');
			expect(config.cloudfrontEnabled).toBe(false);
			expect(config.regions).toEqual([
				{ region: 'us-east-2', suffix: 'east', enabled: true },
				{ region: 'us-west-2', suffix: 'west', enabled: true },
			]);
			expect(config.tags).toEqual({ owner: 'Komodo Future Solutions', managedBy: 'cdk', environment: 'staging' });
		});
	});

	describe('defaultProdConfig', () => {
		it('should create default prod config', () => {
			const config = defaultProdConfig();
			expect(config.name).toBe('');
			expect(config.env).toBe('prod');
			expect(config.account).toBe('123456789012');
			expect(config.cpu).toBe(1024);
			expect(config.memory).toBe(2048);
			expect(config.minCapacity).toBe(1);
			expect(config.maxCapacity).toBe(6);
			expect(config.downstreamUrls).toEqual([]);
			expect(config.upstreamUrls).toEqual([]);
			expect(config.vpcTag).toBe('');
			expect(config.domainName).toBe('');
			expect(config.certificateArn).toBe('');
			expect(config.regions).toEqual([
				{ region: 'us-east-2', suffix: 'east', enabled: true },
				{ region: 'us-west-2', suffix: 'west', enabled: true },
			]);
			expect(config.tags).toEqual({ owner: 'Komodo Future Solutions', managedBy: 'cdk', environment: 'prod' });
		});
	});

	describe('createTags', () => {
		it('should create tags with provided config', () => {
			const config = {
				project: 'test-project',
				owner: 'test-owner',
				environment: 'dev',
				costCenter: '12345',
				managedBy: 'test-manager',
			};
			const tags = createTags(config);
			expect(tags).toMatchObject(config);
		});

		it('should create tags with partial config', () => {
			const config = {
				owner: 'test-owner',
				managedBy: 'test-manager',
			};
			const tags = createTags(config);
			expect(tags.owner).toBe('test-owner');
			expect(tags.managedBy).toBe('test-manager');
			expect(tags.project).toBe('');
			expect(tags.environment).toBe('');
			expect(tags.costCenter).toBe('');
		});

		it('should create tags with empty config', () => {
			const tags = createTags();
			expect(tags.owner).toBe('Komodo Future Solutions');
			expect(tags.managedBy).toBe('cdk');
			expect(tags.project).toBe('');
			expect(tags.environment).toBe('');
			expect(tags.costCenter).toBe('');
		});
	});

	describe('defaultTags', () => {
		it('should create default tags', () => {
			const tags = defaultTags();
			expect(tags).toEqual({
				owner: 'Komodo Future Solutions',
				managedBy: 'cdk',
			});
		});
	});
});
