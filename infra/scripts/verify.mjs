import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './aws-client.mjs';

const foundation = JSON.parse(await readFile(path.join(root, 'infra/cdk.out/goa-dev-foundation.template.json'), 'utf8'));
const runtime = JSON.parse(await readFile(path.join(root, 'infra/cdk.out/goa-dev-runtime.template.json'), 'utf8'));
const resources = template => Object.values(template.Resources);
const ofType = (template, type) => resources(template).filter(item => item.Type === type);
const bucket = ofType(foundation, 'AWS::S3::Bucket')[0].Properties;
assert.ok(Object.values(bucket.PublicAccessBlockConfiguration).every(value => value === true));
assert.equal(bucket.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
assert.equal(ofType(foundation, 'AWS::Cognito::UserPool')[0].Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly, true);
assert.equal(ofType(foundation, 'AWS::Cognito::UserPoolClient')[0].Properties.GenerateSecret, false);
const budget = ofType(foundation, 'AWS::Budgets::Budget')[0].Properties;
assert.ok(budget.Budget.BudgetLimit.Amount <= 25);
assert.equal(budget.Budget.CostTypes.IncludeCredit, false);
assert.equal(budget.NotificationsWithSubscribers.length, 4);
const deployer = ofType(foundation, 'AWS::IAM::Role').find(role => role.Properties.RoleName === 'goa-dev-deployer');
assert.equal(deployer.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service, 'cloudformation.amazonaws.com');
for (const role of ofType(runtime, 'AWS::IAM::Role')) assert.match(role.Properties.PermissionsBoundary, /goa-dev-lambda-boundary$/);
for (const fn of ofType(runtime, 'AWS::Lambda::Function')) {
  assert.ok(!fn.Properties.VpcConfig, 'No unpriced NAT or VPC dependency.');
  const env = fn.Properties.Environment.Variables;
  assert.notEqual(env.ENABLE_LOCAL_DEMO, 'true');
  if (env.DATABASE_URL) {
    assert.equal(new URL(env.DATABASE_URL).password, '');
    assert.equal(env.DATABASE_TLS, 'true');
    assert.equal(env.DATABASE_IAM_AUTH, 'true');
    assert.match(env.DATABASE_URL, /goa_(core|migrator)@/);
  }
}
assert.ok(!JSON.stringify({ foundation, runtime }).includes('AdministratorAccess'));
assert.ok(!resources(runtime).some(item => /NatGateway|EC2::EIP|RDS::DB/.test(item.Type)));
console.log('Infrastructure access, cost, storage, signup and database security checks passed.');

if (process.argv.includes('--packages')) {
  const manifest = JSON.parse(await readFile(path.join(root, 'infra/artifacts/manifest.json'), 'utf8'));
  const directory = path.join(path.dirname(manifest.core.file), 'core', 'dist');
  Object.assign(process.env, { NODE_ENV: 'production', AWS_LAMBDA_FUNCTION_NAME: 'goa-package-check',
    COGNITO_USER_POOL_ID: 'ap-south-1_PackageCheck', COGNITO_CLIENT_ID: 'packagecheck', COGNITO_REGION: 'ap-south-1',
    DATABASE_URL: 'postgresql://goa_core@database.example.invalid/goa', DATABASE_TLS: 'true', DATABASE_IAM_AUTH: 'true', DATABASE_REGION: 'ap-south-1', ENABLE_LOCAL_DEMO: 'false' });
  const core = await import(pathToFileURL(path.join(directory, 'lambda.js')).href);
  const migration = await import(pathToFileURL(path.join(directory, 'migration-lambda.js')).href);
  assert.equal(typeof core.handler, 'function');
  assert.equal(typeof migration.handler, 'function');
  console.log('Bundled core and migration Lambda handlers initialized with production restrictions; no database connection was attempted.');
}
