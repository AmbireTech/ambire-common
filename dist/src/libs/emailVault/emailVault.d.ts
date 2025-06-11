import { EmailVaultData, EmailVaultOperation, EmailVaultSecret, RecoveryKey } from '../../interfaces/emailVault';
import { Fetch } from '../../interfaces/fetch';
export interface Secret {
    key: String;
    type: String;
}
export interface EmailVaultInfo {
    email: String;
    recoveryKey: String;
    availableSecrets: Secret[];
    availableAccounts: any;
}
export declare class EmailVault {
    private callRelayer;
    constructor(fetch: Fetch, relayerUrl: string);
    getRecoveryKeyAddress(email: String, authKey: String): Promise<RecoveryKey>;
    getSessionKey(email: String, authKey: String): Promise<string>;
    getEmailVaultInfo(email: String, authKey: String): Promise<EmailVaultData | null>;
    operations(email: String, authKey: String, operations: EmailVaultOperation[]): Promise<EmailVaultOperation[] | null>;
    getOperations(email: String, authKey: String, operations: EmailVaultOperation[]): Promise<EmailVaultOperation[] | null>;
    addKeyStoreSecret(email: String, authKey: String, keyStoreUid: String, secret: String): Promise<Boolean>;
    retrieveKeyStoreSecret(email: String, authKey: String, keyStoreUid: String): Promise<EmailVaultSecret>;
    addKeyBackup(email: String, authKey: String, keyAddress: String, privateKeyEncryptedJSON: String): Promise<Boolean>;
    retrieveKeyBackup(email: String, authKey: String, keyAddress: String): Promise<EmailVaultSecret>;
    getInfo(email: String, authKey: String): Promise<EmailVaultInfo>;
}
//# sourceMappingURL=emailVault.d.ts.map