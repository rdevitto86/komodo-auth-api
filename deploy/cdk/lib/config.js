"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.envConfigFor = envConfigFor;
function envConfigFor(env) {
    const configs = {
        dev: {
            name: 'dev',
            cpu: 256,
            memory: 512,
            minCapacity: 1,
            maxCapacity: 2,
            secretPath: 'komodo/dev/auth-api',
            userApiUrl: 'http://user-api-public.komodo-dev.local:7052',
            commsApiUrl: 'http://communications-api.komodo-dev.local:7081',
            vpcTag: 'komodo-dev',
            domainName: 'auth-dev.komodo.com',
            certificateArn: '',
            cloudfrontEnabled: false,
            cloudFrontCertificateArn: '',
            regions: [{ region: 'us-east-2', suffix: '', enabled: true }],
        },
        stg: {
            name: 'stg',
            cpu: 512,
            memory: 1024,
            minCapacity: 1,
            maxCapacity: 3,
            secretPath: 'komodo/stg/auth-api',
            userApiUrl: 'http://user-api-public.komodo-stg.local:7052',
            commsApiUrl: 'http://communications-api.komodo-stg.local:7081',
            vpcTag: 'komodo-stg',
            domainName: 'auth-stg.komodo.com',
            certificateArn: '',
            cloudfrontEnabled: true,
            cloudFrontCertificateArn: '',
            regions: [
                { region: 'us-east-2', suffix: 'east', enabled: true },
                { region: 'us-west-2', suffix: 'west', enabled: false },
            ],
        },
        prod: {
            name: 'prod',
            cpu: 1024,
            memory: 2048,
            minCapacity: 1,
            maxCapacity: 6,
            secretPath: 'komodo/prod/auth-api',
            userApiUrl: 'http://user-api-public.komodo-prod.local:7052',
            commsApiUrl: 'http://communications-api.komodo-prod.local:7081',
            vpcTag: 'komodo-prod',
            domainName: 'auth.komodo.com',
            certificateArn: '',
            cloudfrontEnabled: true,
            cloudFrontCertificateArn: '',
            regions: [
                { region: 'us-east-2', suffix: 'east', enabled: true },
                { region: 'us-west-2', suffix: 'west', enabled: false },
            ],
        },
    };
    const cfg = configs[env];
    if (!cfg) {
        throw new Error(`unknown environment ${env}, expected dev|stg|prod`);
    }
    return cfg;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29uZmlnLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vY29uZmlnLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBd0JBLG9DQStEQztBQS9ERCxTQUFnQixZQUFZLENBQUMsR0FBVztJQUN0QyxNQUFNLE9BQU8sR0FBOEI7UUFDekMsR0FBRyxFQUFFO1lBQ0gsSUFBSSxFQUFFLEtBQUs7WUFDWCxHQUFHLEVBQUUsR0FBRztZQUNSLE1BQU0sRUFBRSxHQUFHO1lBQ1gsV0FBVyxFQUFFLENBQUM7WUFDZCxXQUFXLEVBQUUsQ0FBQztZQUNkLFVBQVUsRUFBRSxxQkFBcUI7WUFDakMsVUFBVSxFQUFFLDhDQUE4QztZQUMxRCxXQUFXLEVBQUUsaURBQWlEO1lBQzlELE1BQU0sRUFBRSxZQUFZO1lBQ3BCLFVBQVUsRUFBRSxxQkFBcUI7WUFDakMsY0FBYyxFQUFFLEVBQUU7WUFDbEIsaUJBQWlCLEVBQUUsS0FBSztZQUN4Qix3QkFBd0IsRUFBRSxFQUFFO1lBQzVCLE9BQU8sRUFBRSxDQUFDLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQztTQUM5RDtRQUNELEdBQUcsRUFBRTtZQUNILElBQUksRUFBRSxLQUFLO1lBQ1gsR0FBRyxFQUFFLEdBQUc7WUFDUixNQUFNLEVBQUUsSUFBSTtZQUNaLFdBQVcsRUFBRSxDQUFDO1lBQ2QsV0FBVyxFQUFFLENBQUM7WUFDZCxVQUFVLEVBQUUscUJBQXFCO1lBQ2pDLFVBQVUsRUFBRSw4Q0FBOEM7WUFDMUQsV0FBVyxFQUFFLGlEQUFpRDtZQUM5RCxNQUFNLEVBQUUsWUFBWTtZQUNwQixVQUFVLEVBQUUscUJBQXFCO1lBQ2pDLGNBQWMsRUFBRSxFQUFFO1lBQ2xCLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsd0JBQXdCLEVBQUUsRUFBRTtZQUM1QixPQUFPLEVBQUU7Z0JBQ1AsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRTtnQkFDdEQsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRTthQUN4RDtTQUNGO1FBQ0QsSUFBSSxFQUFFO1lBQ0osSUFBSSxFQUFFLE1BQU07WUFDWixHQUFHLEVBQUUsSUFBSTtZQUNULE1BQU0sRUFBRSxJQUFJO1lBQ1osV0FBVyxFQUFFLENBQUM7WUFDZCxXQUFXLEVBQUUsQ0FBQztZQUNkLFVBQVUsRUFBRSxzQkFBc0I7WUFDbEMsVUFBVSxFQUFFLCtDQUErQztZQUMzRCxXQUFXLEVBQUUsa0RBQWtEO1lBQy9ELE1BQU0sRUFBRSxhQUFhO1lBQ3JCLFVBQVUsRUFBRSxpQkFBaUI7WUFDN0IsY0FBYyxFQUFFLEVBQUU7WUFDbEIsaUJBQWlCLEVBQUUsSUFBSTtZQUN2Qix3QkFBd0IsRUFBRSxFQUFFO1lBQzVCLE9BQU8sRUFBRTtnQkFDUCxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO2dCQUN0RCxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFO2FBQ3hEO1NBQ0Y7S0FDRixDQUFDO0lBRUYsTUFBTSxHQUFHLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3pCLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUNULE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLEdBQUcseUJBQXlCLENBQUMsQ0FBQztJQUN2RSxDQUFDO0lBQ0QsT0FBTyxHQUFHLENBQUM7QUFDYixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGludGVyZmFjZSBSZWdpb25EZXBsb3kge1xuICByZWdpb246IHN0cmluZztcbiAgc3VmZml4OiBzdHJpbmc7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRW52Q29uZmlnIHtcbiAgbmFtZTogc3RyaW5nO1xuICBhY2NvdW50Pzogc3RyaW5nO1xuICBjcHU6IG51bWJlcjtcbiAgbWVtb3J5OiBudW1iZXI7XG4gIG1pbkNhcGFjaXR5OiBudW1iZXI7XG4gIG1heENhcGFjaXR5OiBudW1iZXI7XG4gIHNlY3JldFBhdGg6IHN0cmluZztcbiAgdXNlckFwaVVybDogc3RyaW5nO1xuICBjb21tc0FwaVVybDogc3RyaW5nO1xuICB2cGNUYWc6IHN0cmluZztcbiAgZG9tYWluTmFtZTogc3RyaW5nO1xuICBjZXJ0aWZpY2F0ZUFybjogc3RyaW5nO1xuICBjbG91ZGZyb250RW5hYmxlZDogYm9vbGVhbjtcbiAgY2xvdWRGcm9udENlcnRpZmljYXRlQXJuOiBzdHJpbmc7XG4gIHJlZ2lvbnM6IFJlZ2lvbkRlcGxveVtdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZW52Q29uZmlnRm9yKGVudjogc3RyaW5nKTogRW52Q29uZmlnIHtcbiAgY29uc3QgY29uZmlnczogUmVjb3JkPHN0cmluZywgRW52Q29uZmlnPiA9IHtcbiAgICBkZXY6IHtcbiAgICAgIG5hbWU6ICdkZXYnLFxuICAgICAgY3B1OiAyNTYsXG4gICAgICBtZW1vcnk6IDUxMixcbiAgICAgIG1pbkNhcGFjaXR5OiAxLFxuICAgICAgbWF4Q2FwYWNpdHk6IDIsXG4gICAgICBzZWNyZXRQYXRoOiAna29tb2RvL2Rldi9hdXRoLWFwaScsXG4gICAgICB1c2VyQXBpVXJsOiAnaHR0cDovL3VzZXItYXBpLXB1YmxpYy5rb21vZG8tZGV2LmxvY2FsOjcwNTInLFxuICAgICAgY29tbXNBcGlVcmw6ICdodHRwOi8vY29tbXVuaWNhdGlvbnMtYXBpLmtvbW9kby1kZXYubG9jYWw6NzA4MScsXG4gICAgICB2cGNUYWc6ICdrb21vZG8tZGV2JyxcbiAgICAgIGRvbWFpbk5hbWU6ICdhdXRoLWRldi5rb21vZG8uY29tJyxcbiAgICAgIGNlcnRpZmljYXRlQXJuOiAnJyxcbiAgICAgIGNsb3VkZnJvbnRFbmFibGVkOiBmYWxzZSxcbiAgICAgIGNsb3VkRnJvbnRDZXJ0aWZpY2F0ZUFybjogJycsXG4gICAgICByZWdpb25zOiBbeyByZWdpb246ICd1cy1lYXN0LTInLCBzdWZmaXg6ICcnLCBlbmFibGVkOiB0cnVlIH1dLFxuICAgIH0sXG4gICAgc3RnOiB7XG4gICAgICBuYW1lOiAnc3RnJyxcbiAgICAgIGNwdTogNTEyLFxuICAgICAgbWVtb3J5OiAxMDI0LFxuICAgICAgbWluQ2FwYWNpdHk6IDEsXG4gICAgICBtYXhDYXBhY2l0eTogMyxcbiAgICAgIHNlY3JldFBhdGg6ICdrb21vZG8vc3RnL2F1dGgtYXBpJyxcbiAgICAgIHVzZXJBcGlVcmw6ICdodHRwOi8vdXNlci1hcGktcHVibGljLmtvbW9kby1zdGcubG9jYWw6NzA1MicsXG4gICAgICBjb21tc0FwaVVybDogJ2h0dHA6Ly9jb21tdW5pY2F0aW9ucy1hcGkua29tb2RvLXN0Zy5sb2NhbDo3MDgxJyxcbiAgICAgIHZwY1RhZzogJ2tvbW9kby1zdGcnLFxuICAgICAgZG9tYWluTmFtZTogJ2F1dGgtc3RnLmtvbW9kby5jb20nLFxuICAgICAgY2VydGlmaWNhdGVBcm46ICcnLFxuICAgICAgY2xvdWRmcm9udEVuYWJsZWQ6IHRydWUsXG4gICAgICBjbG91ZEZyb250Q2VydGlmaWNhdGVBcm46ICcnLFxuICAgICAgcmVnaW9uczogW1xuICAgICAgICB7IHJlZ2lvbjogJ3VzLWVhc3QtMicsIHN1ZmZpeDogJ2Vhc3QnLCBlbmFibGVkOiB0cnVlIH0sXG4gICAgICAgIHsgcmVnaW9uOiAndXMtd2VzdC0yJywgc3VmZml4OiAnd2VzdCcsIGVuYWJsZWQ6IGZhbHNlIH0sXG4gICAgICBdLFxuICAgIH0sXG4gICAgcHJvZDoge1xuICAgICAgbmFtZTogJ3Byb2QnLFxuICAgICAgY3B1OiAxMDI0LFxuICAgICAgbWVtb3J5OiAyMDQ4LFxuICAgICAgbWluQ2FwYWNpdHk6IDEsXG4gICAgICBtYXhDYXBhY2l0eTogNixcbiAgICAgIHNlY3JldFBhdGg6ICdrb21vZG8vcHJvZC9hdXRoLWFwaScsXG4gICAgICB1c2VyQXBpVXJsOiAnaHR0cDovL3VzZXItYXBpLXB1YmxpYy5rb21vZG8tcHJvZC5sb2NhbDo3MDUyJyxcbiAgICAgIGNvbW1zQXBpVXJsOiAnaHR0cDovL2NvbW11bmljYXRpb25zLWFwaS5rb21vZG8tcHJvZC5sb2NhbDo3MDgxJyxcbiAgICAgIHZwY1RhZzogJ2tvbW9kby1wcm9kJyxcbiAgICAgIGRvbWFpbk5hbWU6ICdhdXRoLmtvbW9kby5jb20nLFxuICAgICAgY2VydGlmaWNhdGVBcm46ICcnLFxuICAgICAgY2xvdWRmcm9udEVuYWJsZWQ6IHRydWUsXG4gICAgICBjbG91ZEZyb250Q2VydGlmaWNhdGVBcm46ICcnLFxuICAgICAgcmVnaW9uczogW1xuICAgICAgICB7IHJlZ2lvbjogJ3VzLWVhc3QtMicsIHN1ZmZpeDogJ2Vhc3QnLCBlbmFibGVkOiB0cnVlIH0sXG4gICAgICAgIHsgcmVnaW9uOiAndXMtd2VzdC0yJywgc3VmZml4OiAnd2VzdCcsIGVuYWJsZWQ6IGZhbHNlIH0sXG4gICAgICBdLFxuICAgIH0sXG4gIH07XG5cbiAgY29uc3QgY2ZnID0gY29uZmlnc1tlbnZdO1xuICBpZiAoIWNmZykge1xuICAgIHRocm93IG5ldyBFcnJvcihgdW5rbm93biBlbnZpcm9ubWVudCAke2Vudn0sIGV4cGVjdGVkIGRldnxzdGd8cHJvZGApO1xuICB9XG4gIHJldHVybiBjZmc7XG59XG4iXX0=