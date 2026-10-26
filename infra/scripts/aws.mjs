import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// AWS credentials stay in the AWS CLI's user credential store, never in Git.
const root = fileURLToPath(new URL('../..', import.meta.url));
const bundled = path.join(root, '.tools', 'aws-cli', 'Amazon', 'AWSCLIV2', 'aws.exe');
const cli = process.env.GOA_AWS_CLI || (existsSync(bundled) ? bundled : 'aws');
const profile = process.env.AWS_PROFILE || 'goa-dev';
const region = process.env.AWS_REGION || 'ap-south-1';
const action = process.argv[2] || 'doctor';

function run(args, { interactive = false, timeout = 45_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, {
      cwd: root, windowsHide: true, shell: false,
      env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' },
      stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    if (!interactive) {
      child.stdout.on('data', data => { stdout += data; });
      child.stderr.on('data', data => { stderr += data; });
    }
    const timer = setTimeout(() => { child.kill(); }, timeout);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('AWS CLI unavailable. Install AWS CLI v2.32+ or set GOA_AWS_CLI to its executable.'));
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else {
        // Do not echo CLI errors: provider messages may contain account details.
        const safeCode = stderr.match(/\(([A-Za-z][A-Za-z0-9.]+)\) when calling/)?.[1];
        reject(new Error(safeCode || (code === null ? 'AWS request timed out.' : 'AWS login, profile, network, or permissions unavailable.')));
      }
    });
  });
}

async function read(service, operation, args = [], requestRegion = region) {
  const output = await run([
    service, operation, ...args, '--profile', profile, '--region', requestRegion,
    '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '10', '--cli-read-timeout', '25',
  ]);
  return output.trim() ? JSON.parse(output) : {};
}

async function doctor() {
  const version = (await run(['--version'])).trim();
  console.log(`AWS CLI: ${version}`);
  console.log(`Profile: ${profile}; region: ${region}`);
  let identity;
  try { identity = await read('sts', 'get-caller-identity'); }
  catch {
    console.error('AWS is not connected. Run npm run aws:login and finish sign-in in your browser, then rerun npm run aws:doctor.');
    process.exitCode = 1;
    return;
  }
  if (process.env.GOA_AWS_ACCOUNT_ID && identity.Account !== process.env.GOA_AWS_ACCOUNT_ID.replaceAll('-', '')) {
    throw new Error('This AWS profile belongs to a different account. No resources were inspected or changed.');
  }
  console.log(`Account: ********${String(identity.Account).slice(-4)}; authenticated: yes`);
  console.log(`Identity type: ${identity.Arn?.includes(':root') ? 'root (use a dedicated development identity for deployment)' : 'IAM/federated identity'}`);
  const checks = [
    ['Account plan', 'freetier', 'get-account-plan-state', [], 'us-east-1', data => ({
      plan: data.accountPlanType, expiry: data.accountPlanExpirationDate,
      remainingCredits: data.accountPlanRemainingCredits,
    })],
    ['Existing budgets', 'budgets', 'describe-budgets', ['--account-id', identity.Account], 'us-east-1', data =>
      (data.Budgets || []).map(budget => ({ name: budget.BudgetName, limit: budget.BudgetLimit, period: budget.TimeUnit }))],
    ['Cognito pools', 'cognito-idp', 'list-user-pools', ['--max-results', '60'], region, data =>
      (data.UserPools || []).map(pool => ({ name: pool.Name, id: pool.Id }))],
    ['PostgreSQL instances', 'rds', 'describe-db-instances', [], region, data =>
      (data.DBInstances || []).filter(db => db.Engine === 'postgres').map(db => ({
        name: db.DBInstanceIdentifier, status: db.DBInstanceStatus, engine: db.EngineVersion,
        size: db.DBInstanceClass, public: db.PubliclyAccessible,
      }))],
    ['Aurora PostgreSQL clusters', 'rds', 'describe-db-clusters', [], region, data =>
      (data.DBClusters || []).filter(db => db.Engine === 'aurora-postgresql').map(db => ({
        name: db.DBClusterIdentifier, status: db.Status, engine: db.EngineVersion,
        dataApi: db.HttpEndpointEnabled, capacity: db.ServerlessV2ScalingConfiguration,
      }))],
    ['Goa CloudFormation stacks', 'cloudformation', 'list-stacks', [], region, data =>
      (data.StackSummaries || []).filter(stack => /goa/i.test(stack.StackName) && stack.StackStatus !== 'DELETE_COMPLETE')
        .map(stack => ({ name: stack.StackName, status: stack.StackStatus }))],
  ];
  const results = await Promise.allSettled(checks.map(async ([label, service, operation, args, requestRegion, summarize]) => {
    const data = await read(service, operation, args, requestRegion);
    return `${label}: ${JSON.stringify(summarize(data))}`;
  }));
  results.forEach((result, index) => {
    console.log(result.status === 'fulfilled' ? result.value : `${checks[index][0]}: unavailable (${result.reason.message})`);
  });
  console.log('Read-only checks finished. No infrastructure, account plan, budget, or IAM permission was changed.');
  if (results.some(result => result.status === 'rejected')) process.exitCode = 2;
}

try {
  if (action === 'login') {
    await run(['login', '--profile', profile, '--region', region], { interactive: true, timeout: 600_000 });
    console.log('AWS sign-in completed. Run npm run aws:doctor to verify the account and backend prerequisites.');
  } else if (action === 'doctor') await doctor();
  else if (action === 'version') console.log((await run(['--version'])).trim());
  else throw new Error('Use login, doctor, or version.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
