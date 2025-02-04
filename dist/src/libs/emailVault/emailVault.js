import { relayerCall } from '../relayerCall/relayerCall';
export class EmailVault {
    callRelayer;
    constructor(fetch, relayerUrl) {
        this.callRelayer = relayerCall.bind({ url: relayerUrl, fetch });
    }
    async getRecoveryKeyAddress(email, authKey) {
        return (await this.callRelayer(`/email-vault/get-recovery-key/${email}/${authKey}`)).data;
    }
    async getSessionKey(email, authKey) {
        return (await this.callRelayer(`/email-vault/get-session-key/${email}/${authKey}`))?.data
            ?.sessionKey;
    }
    async getEmailVaultInfo(email, authKey) {
        const result = await this.callRelayer(`/email-vault/email-vault-info/${email}/${authKey}`).then((res) => res.data);
        return {
            ...result,
            availableAccounts: Object.fromEntries(result.availableAccounts.map((acc) => [acc.addr, acc])),
            availableSecrets: Object.fromEntries(result.availableSecrets.map((secret) => [secret.key, secret]))
        };
    }
    async operations(email, authKey, operations) {
        return (await this.callRelayer(`/email-vault/post-operations/${email}/${authKey}`, 'POST', {
            operations
        })).data;
    }
    async getOperations(email, authKey, operations) {
        return (await this.callRelayer(`/email-vault/get-operations/${email}/${authKey}`, 'POST', {
            operations
        })).data;
    }
    async addKeyStoreSecret(email, authKey, keyStoreUid, secret) {
        return (await this.callRelayer(`/email-vault/add-key-store-secret/${email}/${authKey}`, 'POST', {
            secret,
            uid: keyStoreUid
        })).success;
    }
    async retrieveKeyStoreSecret(email, authKey, keyStoreUid) {
        return (await this.callRelayer(`/email-vault/retrieve-key-store-secret/${email}/${keyStoreUid}/${authKey}`)).data;
    }
    async addKeyBackup(email, authKey, keyAddress, privateKeyEncryptedJSON) {
        return (await this.callRelayer(`/email-vault/add-key-backup/${email}/${authKey}`, 'POST', {
            keyAddress,
            encryptedBackup: privateKeyEncryptedJSON
        })).success;
    }
    async retrieveKeyBackup(email, authKey, keyAddress) {
        return (await this.callRelayer(`/email-vault/retrieve-key-backup/${email}/${keyAddress}/${authKey}`)).data;
    }
    async getInfo(email, authKey) {
        return (await this.callRelayer(`/email-vault/email-vault-info/${email}/${authKey}`)).data;
    }
}
//# sourceMappingURL=emailVault.js.map