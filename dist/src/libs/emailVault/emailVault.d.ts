import { EmailVaultData, EmailVaultOperation, EmailVaultSecret, RecoveryKey } from '../../interfaces/emailVault';
import { Fetch } from '../../interfaces/fetch';
export interface Secret {
    key: string;
    type: string;
}
export interface EmailVaultInfo {
    email: string;
    recoveryKey: string;
    availableSecrets: Secret[];
    availableAccounts: any;
}
export declare class EmailVault {
    private callRelayer;
    constructor(fetch: Fetch, relayerUrl: string);
    getRecoveryKeyAddress(email: string, authKey: string): Promise<RecoveryKey>;
    getSessionKey(email: string, authKey: string): Promise<string>;
    getEmailVaultInfo(email: string, authKey: string): Promise<EmailVaultData | null>;
    operations(email: string, authKey: string, operations: EmailVaultOperation[]): Promise<EmailVaultOperation[] | null>;
    getOperations(email: string, authKey: string, operations: EmailVaultOperation[]): Promise<EmailVaultOperation[] | null>;
    addKeyStoreSecret(email: string, authKey: string, keyStoreUid: string, secret: string): Promise<boolean>;
    removeKeyStoreSecretFromRelayer(email: string, authKey: string, keyStoreUid: string): Promise<boolean>;
    retrieveKeyStoreSecret(email: string, authKey: string, keyStoreUid: string): Promise<EmailVaultSecret>;
    addKeyBackup(email: string, authKey: string, keyAddress: string, privateKeyEncryptedJSON: string): Promise<boolean>;
    retrieveKeyBackup(email: string, authKey: string, keyAddress: string): Promise<EmailVaultSecret>;
    getInfo(email: string, authKey: string): Promise<EmailVaultInfo>;
}
//# sourceMappingURL=emailVault.d.ts.map