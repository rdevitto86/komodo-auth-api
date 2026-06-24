import type { EnvConfig, RegionDeploy } from './index.js';
export declare const isValidARN: (arn: string) => boolean;
export declare const isValidDomain: (domain: string) => boolean;
export declare const isValidCpu: (cpu: number) => boolean;
export declare const isValidMemory: (memory: number) => boolean;
export declare const isValidCapacity: (capacity: number) => boolean;
export declare const isValidEnvironment: (environment: string) => boolean;
export declare const isValidVersion: (version: string) => boolean;
export declare const isValidRegion: (region: string) => boolean;
export declare const isValidRegionDeploy: (regionDeploy: RegionDeploy) => boolean;
export declare const isValidAccount: (account: string) => boolean;
export declare const isValidTags: (tags: Record<string, string>) => boolean;
export declare const isValidUpstreamDownstreamUrl: (url: string) => boolean;
export declare const validateConfig: (config: EnvConfig) => boolean;
//# sourceMappingURL=validators.d.ts.map