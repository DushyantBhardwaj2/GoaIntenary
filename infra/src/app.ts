import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { App, BootstraplessSynthesizer, CfnOutput, CfnResource, RemovalPolicy, Stack } from 'aws-cdk-lib';

type Config = {
  accountId: string; region: string; monthlyBudgetUsd: number; budgetEmail: string;
  databaseClusterId: string; databaseResourceId: string; databaseHost: string; databaseName: string;
  coreArtifactKey: string; discoveryArtifactKey: string; databaseProviderKey?: string;
};
const infra = fileURLToPath(new URL('..', import.meta.url));
const config: Config = JSON.parse(readFileSync(process.env.GOA_INFRA_CONFIG || path.join(infra, 'config/dev.example.json'), 'utf8'));
const account = config.accountId || '111111111111';
if (!/^\d{12}$/.test(account) || config.region !== 'ap-south-1' || config.monthlyBudgetUsd <= 0 || config.monthlyBudgetUsd > 25) throw new Error('Invalid development account, region or budget.');
const app = new App({ outdir: path.join(infra, 'cdk.out') });
const settings = { env: { account, region: config.region }, synthesizer: new BootstraplessSynthesizer() };
const foundation = new Stack(app, 'goa-dev-foundation', settings);
const runtime = new Stack(app, 'goa-dev-runtime', settings);
const arn = (service: string, resource: string) => `arn:aws:${service}:${config.region}:${account}:${resource}`;
const assetsBucket = `goa-dev-assets-${account}-${config.region}`;
const boundaryArn = `arn:aws:iam::${account}:policy/goa-dev-lambda-boundary`;
const lambdaRoleArn = `arn:aws:iam::${account}:role/goa-dev-lambda-*`;
const dbUserArn = (user: string) => arn('rds-db', `dbuser:${config.databaseResourceId}/${user}`);
const policy = (Statement: unknown[]) => ({ Version: '2012-10-17', Statement });
const allow = (Action: string | string[], Resource: string | string[], extra: object = {}) => ({ Effect: 'Allow', Action, Resource, ...extra });
function resource(stack: Stack, id: string, type: string, properties: Record<string, unknown>, retain = false) {
  const result = new CfnResource(stack, id, { type, properties });
  if (retain) result.applyRemovalPolicy(RemovalPolicy.RETAIN);
  return result;
}

const budgetResource = resource(foundation, 'DevelopmentBudget', 'AWS::Budgets::Budget', {
  Budget: { BudgetName: 'goa-dev-monthly-usage', BudgetType: 'COST', TimeUnit: 'MONTHLY',
    BudgetLimit: { Amount: config.monthlyBudgetUsd, Unit: 'USD' },
    CostTypes: { IncludeCredit: false, IncludeRefund: false, IncludeTax: true, IncludeSupport: true, IncludeSubscription: true } },
  NotificationsWithSubscribers: [50, 80, 100].map(Threshold => ({
    Notification: { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', ThresholdType: 'PERCENTAGE', Threshold },
    Subscribers: [{ SubscriptionType: 'EMAIL', Address: config.budgetEmail || 'reviewer@example.invalid' }],
  })).concat([{ Notification: { NotificationType: 'FORECASTED', ComparisonOperator: 'GREATER_THAN', ThresholdType: 'PERCENTAGE', Threshold: 100 },
    Subscribers: [{ SubscriptionType: 'EMAIL', Address: config.budgetEmail || 'reviewer@example.invalid' }] }]),
}, true);

const assetBucketResource = resource(foundation, 'DeploymentAssets', 'AWS::S3::Bucket', {
  BucketName: assetsBucket,
  PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
  BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
  VersioningConfiguration: { Status: 'Enabled' },
  LifecycleConfiguration: { Rules: [{ Id: 'OldAssetVersions', Status: 'Enabled', NoncurrentVersionExpiration: { NoncurrentDays: 7 } }] },
  Tags: [{ Key: 'Project', Value: 'goa' }, { Key: 'Environment', Value: 'dev' }],
}, true);
resource(foundation, 'AssetsRequireTls', 'AWS::S3::BucketPolicy', { Bucket: assetsBucket, PolicyDocument: policy([
  { Effect: 'Deny', Principal: '*', Action: 's3:*', Resource: [`arn:aws:s3:::${assetsBucket}`, `arn:aws:s3:::${assetsBucket}/*`], Condition: { Bool: { 'aws:SecureTransport': 'false' } } },
]) }).addResourceDependency(assetBucketResource);

const pool = resource(foundation, 'UserPool', 'AWS::Cognito::UserPool', {
  UserPoolName: 'goa-dev-users', UserPoolTier: 'LITE', DeletionProtection: 'ACTIVE',
  UsernameAttributes: ['email'], UsernameConfiguration: { CaseSensitive: false },
  AutoVerifiedAttributes: ['email'], AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
  AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }] },
  Policies: { PasswordPolicy: { MinimumLength: 12, RequireLowercase: true, RequireUppercase: true, RequireNumbers: true, RequireSymbols: true, TemporaryPasswordValidityDays: 1 } },
  UserPoolTags: { Project: 'goa', Environment: 'dev' },
}, true);
const client = resource(foundation, 'UserPoolClient', 'AWS::Cognito::UserPoolClient', {
  ClientName: 'goa-dev-web', UserPoolId: pool.ref, GenerateSecret: false,
  ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
  PreventUserExistenceErrors: 'ENABLED', EnableTokenRevocation: true,
  AccessTokenValidity: 15, IdTokenValidity: 15, RefreshTokenValidity: 7,
  TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'days' },
});
const runtimePermissions = [
  allow(['logs:CreateLogStream', 'logs:PutLogEvents'], arn('logs', 'log-group:/aws/lambda/goa-dev-*:*')),
  allow('rds-db:connect', [dbUserArn('goa_core'), dbUserArn('goa_migrator')]),
];
resource(foundation, 'LambdaBoundary', 'AWS::IAM::ManagedPolicy', {
  ManagedPolicyName: 'goa-dev-lambda-boundary', PolicyDocument: policy(runtimePermissions),
}, true);
const deployer = resource(foundation, 'Deployer', 'AWS::IAM::Role', {
  RoleName: 'goa-dev-deployer', MaxSessionDuration: 3600,
  AssumeRolePolicyDocument: policy([{ Effect: 'Allow', Principal: { Service: 'cloudformation.amazonaws.com' }, Action: 'sts:AssumeRole' }]),
  Policies: [{ PolicyName: 'GoaDevelopmentDeployment', PolicyDocument: policy([
    allow(['cloudformation:CreateStack', 'cloudformation:UpdateStack', 'cloudformation:DescribeStacks', 'cloudformation:DescribeStackEvents', 'cloudformation:GetTemplate', 'cloudformation:CreateChangeSet', 'cloudformation:DescribeChangeSet', 'cloudformation:ExecuteChangeSet', 'cloudformation:DeleteChangeSet'], arn('cloudformation', 'stack/goa-dev-runtime/*')),
    allow('cloudformation:ValidateTemplate', '*'),
    allow(['s3:GetObject', 's3:PutObject'], `arn:aws:s3:::${assetsBucket}/*`),
    allow(['s3:ListBucket', 's3:GetBucketLocation'], `arn:aws:s3:::${assetsBucket}`),
    allow('iam:CreateRole', lambdaRoleArn, { Condition: { ArnEquals: { 'iam:PermissionsBoundary': boundaryArn } } }),
    allow(['iam:GetRole', 'iam:PutRolePolicy', 'iam:GetRolePolicy', 'iam:ListRolePolicies', 'iam:ListAttachedRolePolicies', 'iam:DeleteRolePolicy', 'iam:DeleteRole', 'iam:TagRole', 'iam:UntagRole'], lambdaRoleArn),
    allow('iam:PassRole', lambdaRoleArn, { Condition: { StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' } } }),
    allow(['lambda:CreateFunction', 'lambda:UpdateFunctionCode', 'lambda:UpdateFunctionConfiguration', 'lambda:GetFunction', 'lambda:GetFunctionConfiguration', 'lambda:DeleteFunction', 'lambda:AddPermission', 'lambda:RemovePermission', 'lambda:GetPolicy', 'lambda:TagResource', 'lambda:UntagResource', 'lambda:ListTags', 'lambda:InvokeFunction'], arn('lambda', 'function:goa-dev-*')),
    allow(['logs:CreateLogGroup', 'logs:PutRetentionPolicy', 'logs:DeleteLogGroup', 'logs:TagResource', 'logs:UntagResource', 'logs:ListTagsForResource', 'logs:DescribeLogStreams', 'logs:GetLogEvents', 'logs:FilterLogEvents'], [arn('logs', 'log-group:/aws/lambda/goa-dev-*'), arn('logs', 'log-group:/aws/lambda/goa-dev-*:*')]),
    allow('logs:DescribeLogGroups', '*'),
    allow(['apigateway:GET', 'apigateway:POST', 'apigateway:PATCH', 'apigateway:PUT', 'apigateway:DELETE'], [`arn:aws:apigateway:${config.region}::/apis`, `arn:aws:apigateway:${config.region}::/apis/*`]),
    allow(['apigateway:TagResource', 'apigateway:UntagResource'], `arn:aws:apigateway:${config.region}::/apis/*`),
    allow(['apigateway:GET', 'apigateway:POST', 'apigateway:DELETE'], `arn:aws:apigateway:${config.region}::/tags/arn%3Aaws%3Aapigateway%3A${config.region}%3A%3A%2Fv2%2Fapis%2F*`),
    allow(['rds:DescribeDBClusters', 'rds:DescribeDBInstances', 'rds:DescribeDBEngineVersions', 'rds:DescribeOrderableDBInstanceOptions'], '*'),
    allow(['rds:CreateDBCluster', 'rds:CreateDBInstance', 'rds:EnableInternetAccessGateway', 'rds:AddTagsToResource', 'rds:ModifyDBCluster'], [arn('rds', `cluster:${config.databaseClusterId}`), arn('rds', 'db:goa-dev-*')]),
    allow('ec2:DescribeAvailabilityZones', '*'),
    allow('iam:CreateServiceLinkedRole', `arn:aws:iam::${account}:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS`, { Condition: { StringEquals: { 'iam:AWSServiceName': 'rds.amazonaws.com' } } }),
  ]) }], Tags: [{ Key: 'Project', Value: 'goa' }, { Key: 'Environment', Value: 'dev' }],
}, true);
new CfnOutput(foundation, 'DeployerRoleArn', { value: deployer.getAtt('Arn').toString() });
new CfnOutput(foundation, 'AssetsBucket', { value: assetsBucket });
new CfnOutput(foundation, 'CognitoUserPoolId', { value: pool.ref, exportName: 'goa-dev-user-pool-id' });
new CfnOutput(foundation, 'CognitoClientId', { value: client.ref, exportName: 'goa-dev-client-id' });

// CloudFormation does not expose WithExpressConfiguration on DBCluster. This
// small, scoped provider owns creation while retaining the protected database.
if (config.databaseProviderKey) {
const databaseProviderRole = resource(foundation, 'DatabaseProviderRole', 'AWS::IAM::Role', {
  RoleName: 'goa-dev-database-provisioner',
  AssumeRolePolicyDocument: policy([{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }]),
  Policies: [{ PolicyName: 'CreateGoaExpressOnly', PolicyDocument: policy([
    allow(['rds:DescribeDBClusters', 'rds:DescribeDBInstances', 'ec2:DescribeAvailabilityZones'], '*'),
    allow(['rds:CreateDBCluster', 'rds:CreateDBInstance', 'rds:EnableInternetAccessGateway', 'rds:AddTagsToResource'], [arn('rds', `cluster:${config.databaseClusterId}`), arn('rds', 'db:goa-dev-*')]),
    allow('iam:CreateServiceLinkedRole', `arn:aws:iam::${account}:role/aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS`, { Condition: { StringEquals: { 'iam:AWSServiceName': 'rds.amazonaws.com' } } }),
    allow(['logs:CreateLogStream', 'logs:PutLogEvents'], arn('logs', 'log-group:/aws/lambda/goa-dev-provision-database-v2:*')),
  ]) }], Tags: [{ Key: 'Project', Value: 'goa' }],
});
const databaseProvider = resource(foundation, 'DatabaseProvider', 'AWS::Lambda::Function', {
  FunctionName: 'goa-dev-provision-database-v2', Runtime: 'nodejs22.x', Handler: 'index.handler', Timeout: 120, MemorySize: 256,
  Role: databaseProviderRole.getAtt('Arn'),
  Code: { S3Bucket: assetsBucket, S3Key: config.databaseProviderKey },
  Tags: [{ Key: 'Project', Value: 'goa' }, { Key: 'Environment', Value: 'dev' }],
});
resource(foundation, 'ExpressDatabase', 'Custom::GoaAuroraExpress', {
  ServiceToken: databaseProvider.getAtt('Arn'), ClusterId: config.databaseClusterId,
}, true);

}

const { Fn } = await import('aws-cdk-lib');
const poolId = Fn.importValue('goa-dev-user-pool-id'), clientId = Fn.importValue('goa-dev-client-id');
const commonEnv = { NODE_ENV: 'production', ENABLE_LOCAL_DEMO: 'false', COGNITO_REGION: config.region,
  COGNITO_USER_POOL_ID: poolId, COGNITO_CLIENT_ID: clientId, DATABASE_TLS: 'true', DATABASE_IAM_AUTH: 'true', DATABASE_REGION: config.region };
function lambdaFunction(name: string, handler: string, runtimeName: string, key: string, environment: object, databaseUser?: string, timeout = 28) {
  const role = resource(runtime, `${name}Role`, 'AWS::IAM::Role', {
    RoleName: `goa-dev-lambda-${name.toLowerCase()}`, PermissionsBoundary: boundaryArn,
    AssumeRolePolicyDocument: policy([{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }]),
    Policies: [{ PolicyName: 'Runtime', PolicyDocument: policy([
      allow(['logs:CreateLogStream', 'logs:PutLogEvents'], arn('logs', `log-group:/aws/lambda/goa-dev-${name.toLowerCase()}:*`)),
      ...(databaseUser ? [allow('rds-db:connect', dbUserArn(databaseUser))] : []),
    ]) }], Tags: [{ Key: 'Project', Value: 'goa' }],
  });
  const logs = resource(runtime, `${name}Logs`, 'AWS::Logs::LogGroup', { LogGroupName: `/aws/lambda/goa-dev-${name.toLowerCase()}`, RetentionInDays: 7 }, true);
  const fn = resource(runtime, name, 'AWS::Lambda::Function', {
    FunctionName: `goa-dev-${name.toLowerCase()}`, Runtime: runtimeName, Handler: handler,
    Role: role.getAtt('Arn'), Code: { S3Bucket: assetsBucket, S3Key: key },
    Architectures: ['x86_64'], MemorySize: name === 'Discovery' ? 256 : 512, Timeout: timeout,
    Environment: { Variables: environment }, Tags: [{ Key: 'Project', Value: 'goa' }, { Key: 'Environment', Value: 'dev' }],
  });
  fn.addResourceDependency(logs);
  return fn;
}
const dbUrl = (user: string) => `postgresql://${user}@${config.databaseHost}:5432/${config.databaseName}`;
const core = lambdaFunction('Core', 'dist/lambda.handler', 'nodejs22.x', config.coreArtifactKey, { ...commonEnv, DATABASE_URL: dbUrl('goa_core') }, 'goa_core');
lambdaFunction('Migrate', 'dist/migration-lambda.handler', 'nodejs22.x', config.coreArtifactKey, { ...commonEnv, DATABASE_URL: dbUrl('goa_migrator') }, 'goa_migrator', 120);
const discovery = lambdaFunction('Discovery', 'app.lambda_handler.handler', 'python3.11', config.discoveryArtifactKey, { NODE_ENV: 'production' });
for (const [name, fn] of [['core', core], ['discovery', discovery]] as const) {
  const api = resource(runtime, `${name}Api`, 'AWS::ApiGatewayV2::Api', { Name: `goa-dev-${name}`, ProtocolType: 'HTTP', Tags: { Project: 'goa', Environment: 'dev' } });
  const integration = resource(runtime, `${name}Integration`, 'AWS::ApiGatewayV2::Integration', { ApiId: api.ref, IntegrationType: 'AWS_PROXY', IntegrationUri: fn.getAtt('Arn'), PayloadFormatVersion: '2.0', TimeoutInMillis: 29_000 });
  const route = resource(runtime, `${name}Route`, 'AWS::ApiGatewayV2::Route', { ApiId: api.ref, RouteKey: '$default', Target: Fn.join('', ['integrations/', integration.ref]) });
  resource(runtime, `${name}Stage`, 'AWS::ApiGatewayV2::Stage', { ApiId: api.ref, StageName: '$default', AutoDeploy: true, DefaultRouteSettings: { ThrottlingBurstLimit: 10, ThrottlingRateLimit: 5 } }).addResourceDependency(route);
  resource(runtime, `${name}Permission`, 'AWS::Lambda::Permission', { Action: 'lambda:InvokeFunction', FunctionName: fn.ref, Principal: 'apigateway.amazonaws.com', SourceArn: Fn.join('', [arn('execute-api', ''), api.ref, '/*']) });
  new CfnOutput(runtime, name === 'core' ? 'CoreApiUrl' : 'DiscoveryApiUrl', { value: api.getAtt('ApiEndpoint').toString() });
}
for (const item of foundation.node.findAll()) {
  if (item instanceof CfnResource && item !== budgetResource) item.addResourceDependency(budgetResource);
}
app.synth();
console.log('Development CloudFormation templates synthesized. No AWS resources were changed.');
