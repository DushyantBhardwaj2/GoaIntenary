import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { aws, cli, command, region, root } from './aws-client.mjs';
import { packageProvider } from './package-provider.mjs';

const configFile = path.join(root, 'infra/config/dev.local.json');
const action = process.argv[2];
let config;
if (existsSync(configFile)) config = JSON.parse(await readFile(configFile, 'utf8'));
else config = JSON.parse(await readFile(path.join(root, 'infra/config/dev.example.json'), 'utf8'));
async function save() { await writeFile(configFile, JSON.stringify(config, null, 2)); }
async function synth() {
  await command(process.execPath, [path.join(root, 'infra/node_modules/typescript/bin/tsc')], { cwd: path.join(root, 'infra') });
  await command(process.execPath, [path.join(root, 'infra/dist/app.js')], { env: { GOA_INFRA_CONFIG: configFile } });
}
async function apply(stack, profile) {
  await synth();
  const serviceRole = stack === 'goa-dev-runtime' ? ['--role-arn', `arn:aws:iam::${config.accountId}:role/goa-dev-deployer`] : [];
  const recovery = stack === 'goa-dev-runtime' ? ['--disable-rollback'] : [];
  await command(cli, ['cloudformation', 'deploy', '--stack-name', stack,
    '--template-file', path.join(root, 'infra/cdk.out', `${stack}.template.json`),
    '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-fail-on-empty-changeset',
    ...serviceRole, ...recovery, '--tags', 'Project=goa', 'Environment=dev', '--region', region, '--profile', profile, '--no-cli-pager'], { timeout: 900_000 });
  const data = await aws('cloudformation', 'describe-stacks', ['--stack-name', stack], { profile });
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(data.Stacks?.[0]?.StackStatus)) throw new Error('CloudFormation stack did not complete successfully.');
  const outputs = Object.fromEntries((data.Stacks[0].Outputs || []).map(output => [output.OutputKey, output.OutputValue]));
  await writeFile(path.join(root, 'infra', `deployment-outputs-${stack}.json`), JSON.stringify(outputs, null, 2));
  console.log(`${stack}: ${data.Stacks[0].StackStatus}`);
  return outputs;
}

try {
  const identity = await aws('sts', 'get-caller-identity');
  if (config.accountId && identity.Account !== config.accountId) throw new Error('Wrong AWS account; stopping.');
  if (process.env.GOA_AWS_ACCOUNT_ID && identity.Account !== process.env.GOA_AWS_ACCOUNT_ID.replaceAll('-', '')) throw new Error('Wrong intended AWS account; stopping.');
  config.accountId = identity.Account;
  if (region !== 'ap-south-1') throw new Error('This development setup is restricted to Mumbai.');
  if (action === 'foundation') {
    const plan = await aws('freetier', 'get-account-plan-state', [], { requestRegion: 'us-east-1' });
    if (plan.accountPlanType !== 'FREE' || Number(plan.accountPlanRemainingCredits?.amount || 0) <= 0) throw new Error('The verified Free Plan/credits are unavailable. No plan upgrade will be attempted.');
    config.budgetEmail = process.env.GOA_BUDGET_EMAIL || config.budgetEmail;
    if (process.env.GOA_MONTHLY_BUDGET_USD) config.monthlyBudgetUsd = Number(process.env.GOA_MONTHLY_BUDGET_USD);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.budgetEmail) || config.budgetEmail.endsWith('.invalid')) throw new Error('Set GOA_BUDGET_EMAIL to the owner-chosen recipient.');
    await save();
    const outputsFile = path.join(root, 'infra/deployment-outputs-goa-dev-foundation.json');
    let outputs;
    if (existsSync(outputsFile)) outputs = JSON.parse(await readFile(outputsFile, 'utf8'));
    else {
      delete config.databaseProviderKey; await save();
      outputs = await apply('goa-dev-foundation', 'goa-dev');
    }
    const providerLogName = '/aws/lambda/goa-dev-provision-database-v2';
    const logGroups = await aws('logs', 'describe-log-groups', ['--log-group-name-prefix', providerLogName]);
    if (!logGroups.logGroups?.some(group => group.logGroupName === providerLogName)) await aws('logs', 'create-log-group', ['--log-group-name', providerLogName]);
    await aws('logs', 'put-retention-policy', ['--log-group-name', providerLogName, '--retention-in-days', '7']);
    const provider = await packageProvider();
    await aws('s3api', 'put-object', ['--bucket', outputs.AssetsBucket, '--key', provider.key, '--body', provider.file, '--server-side-encryption', 'AES256']);
    config.databaseProviderKey = provider.key; await save();
    outputs = await apply('goa-dev-foundation', 'goa-dev');
    const role = await aws('iam', 'get-role', ['--role-name', 'goa-dev-deployer']);
    if (!role.Role?.AssumeRolePolicyDocument?.Statement?.some(statement => statement.Principal?.Service === 'cloudformation.amazonaws.com')) throw new Error('CloudFormation deployment service role verification failed.');
    const notifications = await aws('budgets', 'describe-notifications-for-budget', ['--account-id', config.accountId, '--budget-name', 'goa-dev-monthly-usage'], { requestRegion: 'us-east-1' });
    if (notifications.Notifications?.length !== 4) throw new Error('Budget alert verification failed.');
    console.log('Scoped CloudFormation service role and four budget thresholds verified. Public Cognito signup is disabled.');
  } else if (action === 'database') {
    const profile = 'goa-dev';
    let clusters = await aws('rds', 'describe-db-clusters', [], { profile });
    let db = clusters.DBClusters?.find(item => item.DBClusterIdentifier === config.databaseClusterId);
    if (!db) throw new Error('Foundation must create the scoped Aurora Express resource first.');
    await aws('rds', 'wait', ['db-cluster-available', '--db-cluster-identifier', config.databaseClusterId], { profile, timeout: 900_000 });
    clusters = await aws('rds', 'describe-db-clusters', ['--db-cluster-identifier', config.databaseClusterId], { profile });
    db = clusters.DBClusters[0];
    if (!db.IAMDatabaseAuthenticationEnabled || db.ServerlessV2ScalingConfiguration?.MaxCapacity > 1 || db.ServerlessV2ScalingConfiguration?.MinCapacity !== 0) throw new Error('Database security/capacity differs from the reviewed configuration.');
    config.databaseHost = db.Endpoint;
    config.databaseResourceId = db.DbClusterResourceId;
    config.databaseEngineVersion = db.EngineVersion;
    await save();
    console.log(`Aurora Express is ${db.Status}; PostgreSQL ${db.EngineVersion}; min 0 / max 1 ACU.`);
    console.log('Next: initialize SQL roles, then rerun foundation to restrict the Lambda boundary to this database.');
  } else if (action === 'runtime') {
    if (config.databaseHost === 'pending' || config.databaseResourceId === 'pending') throw new Error('Create and initialize the development database first.');
    const manifest = JSON.parse(await readFile(path.join(root, 'infra/artifacts/manifest.json'), 'utf8'));
    for (const name of ['core', 'discovery']) {
      await aws('s3api', 'put-object', ['--bucket', `goa-dev-assets-${config.accountId}-${region}`, '--key', manifest[name].key, '--body', manifest[name].file, '--server-side-encryption', 'AES256'], { profile: 'goa-dev' });
    }
    config.coreArtifactKey = manifest.core.key; config.discoveryArtifactKey = manifest.discovery.key;
    await save();
    const outputs = await apply('goa-dev-runtime', 'goa-dev');
    console.log(`Core API: ${outputs.CoreApiUrl}\nDiscovery API: ${outputs.DiscoveryApiUrl}`);
  } else if (action === 'migrate') {
    const payloadFile = path.join(root, 'infra/artifacts/migration-result.json');
    const result = await aws('lambda', 'invoke', ['--function-name', 'goa-dev-migrate', '--cli-binary-format', 'raw-in-base64-out', '--payload', '{}', payloadFile], { profile: 'goa-dev' });
    const payload = JSON.parse(await readFile(payloadFile, 'utf8'));
    if (result.FunctionError || payload.status !== 'ok') throw new Error('Migration Lambda failed. Check its redacted logs; no credentials are printed.');
    console.log(`PostgreSQL migrations applied through version ${payload.version}.`);
  } else throw new Error('Use foundation, database, runtime or migrate.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
