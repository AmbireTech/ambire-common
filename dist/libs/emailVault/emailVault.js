"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailVault = void 0;
const relayerCall_1 = require("../relayerCall/relayerCall");
class EmailVault {
    constructor(fetch, relayerUrl) {
        this.callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl });
        this.relayerUrl = relayerUrl;
        this.fetch = fetch;
    }
    async create(email, authKey) {
        return (await this.callRelayer(`/email-vault/create/${email}/${authKey}`)).data;
    }
    async getRecoveryKeyAddress(email, authKey) {
        return (await this.callRelayer(`/email-vault/getRecoveryKey/${email}/${authKey}`)).data;
    }
    async getSessionKey(email, authKey) {
        return (await this.callRelayer(`/email-vault/emailVaultInfo/${email}/${authKey}`)).data;
    }
    async getEmailVaultInfo(email, authKey) {
        const result = (await this.callRelayer(`/email-vault/emailVaultInfo/${email}/${authKey}`)).data;
        return {
            ...result,
            availableAccounts: Object.fromEntries(result.availableAccounts.map((acc) => [acc.addr, acc])),
            availableSecrets: Object.fromEntries(result.availableSecrets.map((secret) => [secret.key, secret]))
        };
    }
    async addKeyStoreSecret(email, authKey, keyStoreUid, secret) {
        return (await this.callRelayer(`/email-vault/addKeyStoreSecret/${email}/${authKey}`, 'POST', {
            secret,
            uid: keyStoreUid
        })).success;
    }
    async retrieveKeyStoreSecret(email, authKey, keyStoreUid) {
        return (await this.callRelayer(`/email-vault/retrieveKeyStoreSecret/${email}/${keyStoreUid}/${authKey}`)).data;
    }
    async addKeyBackup(email, authKey, keyAddress, privateKeyEncryptedJSON) {
        return (await this.callRelayer(`/email-vault/addKeyBackup/${email}/${authKey}`, 'POST', {
            keyAddress,
            encryptedBackup: privateKeyEncryptedJSON
        })).success;
    }
    async retrieveKeyBackup(email, authKey, keyAddress) {
        return (await this.callRelayer(`/email-vault/retrieveKeyBackup/${email}/${keyAddress}/${authKey}`)).data;
    }
    async getInfo(email, authKey) {
        return (await this.callRelayer(`/email-vault/emailVaultInfo/${email}/${authKey}`)).data;
    }
}
exports.EmailVault = EmailVault;
//# sourceMappingURL=emailVault.js.map