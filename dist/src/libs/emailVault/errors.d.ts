type EmailVaultErrorCode = 'INVALID_KEY' | 'NOT_FOUND' | 'CREATE_FAILED' | 'MISSING_PARAMS' | 'TIMEOUT' | 'UNKNOWN';
declare function classifyEmailVaultError(err: Error | undefined): EmailVaultErrorCode;
declare function friendlyEmailVaultMessage(code: EmailVaultErrorCode, email: string): string;
export { classifyEmailVaultError, friendlyEmailVaultMessage };
//# sourceMappingURL=errors.d.ts.map