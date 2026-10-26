import { createHmac, timingSafeEqual } from 'node:crypto';
import { CognitoIdentityProviderClient, GetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { CoreConfig } from './config.js';
import { ApiError, unauthenticated } from './errors.js';
import type { Identity } from './types.js';

// Real Cognito subjects have UUID text shape without consistent RFC variant
// bits. Identity comes from verified issuer/signature/client claims; validate
// PostgreSQL's canonical hex shape without rejecting provider-issued subjects.
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Authenticate = (token: string, ip: string) => Promise<Identity>;
const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const syntheticAccounts: Record<string, { displayName: string; email: string }> = {
  '10000000-0000-4000-8000-000000000001': { displayName: 'Aman', email: 'aman@example.invalid' },
  '10000000-0000-4000-8000-000000000002': { displayName: 'Riya', email: 'riya@example.invalid' },
  '10000000-0000-4000-8000-000000000003': { displayName: 'Dev', email: 'dev@example.invalid' },
};

export function verifyLocalToken(token: string, secret: string, now = Date.now()): Identity {
  const [prefix, encoded, signature, extra] = token.split('.');
  if (prefix !== 'local' || !encoded || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) throw unauthenticated();
  const expected = createHmac('sha256', secret).update(`local.${encoded}`).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw unauthenticated();
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.sub !== 'string' || !uuidPattern.test(payload.sub) ||
      typeof payload.email !== 'string' || !/^[^@\s]+@example\.invalid$/.test(payload.email) || payload.email.length > 254 ||
      typeof payload.displayName !== 'string' || !payload.displayName.trim() || payload.displayName.length > 100 ||
      typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp * 1000 <= now) throw unauthenticated();
    const fixture = syntheticAccounts[payload.sub.toLowerCase()];
    if (!fixture || fixture.displayName !== payload.displayName || fixture.email !== payload.email) throw unauthenticated();
    return { id: payload.sub.toLowerCase(), ...fixture };
  } catch { throw unauthenticated(); }
}

export function createAuthenticator(config: CoreConfig): Authenticate {
  if (config.localDemo) {
    if (config.production || config.lambda || !config.localSecret || Buffer.byteLength(config.localSecret) < 32) {
      throw new Error('Unsafe synthetic account configuration.');
    }
    return async (token, ip) => {
      if (!loopback.has(ip)) throw unauthenticated();
      return verifyLocalToken(token, config.localSecret!);
    };
  }
  if (!config.cognitoUserPoolId || !config.cognitoClientId) throw new Error('Cognito configuration is missing.');
  const verifier = CognitoJwtVerifier.create({ userPoolId: config.cognitoUserPoolId, tokenUse: 'access', clientId: config.cognitoClientId });
  const cognito = new CognitoIdentityProviderClient({ region: config.cognitoRegion, maxAttempts: 2 });
  return async (token) => {
    let subject: string;
    try {
      const verified = await verifier.verify(token);
      subject = verified.sub;
      if (!uuidPattern.test(subject)) throw unauthenticated();
    } catch { throw unauthenticated(); }
    // Access JWTs need not include display attributes. GetUser is authorised with
    // the already verified user's token, never with privileged IAM credentials.
    try {
      const result = await cognito.send(new GetUserCommand({ AccessToken: token }));
      const attributes = new Map(result.UserAttributes?.map(({ Name, Value }) => [Name, Value]));
      if (attributes.get('sub') !== subject) throw unauthenticated();
      const name = attributes.get('name') || attributes.get('preferred_username');
      const email = attributes.get('email');
      return { id: subject, displayName: name?.slice(0, 100), email: email?.slice(0, 254) };
    } catch (error) {
      if (error instanceof Error && ['NotAuthorizedException', 'UserNotFoundException'].includes(error.name)) throw unauthenticated();
      if (error instanceof ApiError) throw error;
      // A JWT with no GetUser scope can still have a safe, verified identity.
      // Preserve an existing app profile or use "Traveller" and no email.
      return { id: subject };
    }
  };
}
