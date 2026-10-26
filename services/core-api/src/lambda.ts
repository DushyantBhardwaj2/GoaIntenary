import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

// Force deployment restrictions even if a test runner imports this entry point.
const config = loadConfig({ ...process.env, AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME || 'core-api' });
const app = await buildApp({ config, runMigrations: false });
export const handler = awsLambdaFastify(app, { serializeLambdaArguments: false, decorateRequest: false });
await app.ready();
