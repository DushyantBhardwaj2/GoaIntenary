export type ErrorCode = 'UNAUTHENTICATED' | 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_ERROR' | 'CONFLICT' | 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE';

export class ApiError extends Error {
  constructor(public readonly statusCode: number, public readonly code: ErrorCode, message: string) {
    super(message);
  }
}
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'That resource is unavailable.');
export const unauthenticated = () => new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
export const forbidden = () => new ApiError(403, 'FORBIDDEN', 'Only the organiser can do that.');
export const invalid = (message = 'Check the supplied information.') => new ApiError(400, 'VALIDATION_ERROR', message);
