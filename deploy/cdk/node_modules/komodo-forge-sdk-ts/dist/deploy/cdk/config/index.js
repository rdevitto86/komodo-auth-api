import { DEFAULT_ACCOUNT_DEV, DEFAULT_ACCOUNT_PROD, DEFAULT_ACCOUNT_STAGING, DEFAULT_REGION_EAST, DEFAULT_REGION_WEST, ENV_DEV, ENV_PROD, ENV_STAGING, } from '../constants.js';
export * from './validators.js';
export const createEmptyConfig = () => ({
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
export const defaultDevConfig = () => ({
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
export const defaultStgConfig = () => ({
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
export const defaultProdConfig = () => ({
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
export const createRegionDeploy = (region, suffix, enabled) => ({ region, suffix, enabled });
export const createTags = (config) => ({
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
export const defaultTags = () => ({
    owner: 'Komodo Future Solutions',
    managedBy: 'cdk',
});
//# sourceMappingURL=index.js.map