export interface RegionDeploy {
    region: string;
    suffix: string;
    enabled: boolean;
}
export interface EnvConfig {
    name: string;
    account?: string;
    cpu: number;
    memory: number;
    minCapacity: number;
    maxCapacity: number;
    secretPath: string;
    userApiUrl: string;
    commsApiUrl: string;
    vpcTag: string;
    domainName: string;
    certificateArn: string;
    cloudfrontEnabled: boolean;
    cloudFrontCertificateArn: string;
    regions: RegionDeploy[];
}
export declare function envConfigFor(env: string): EnvConfig;
