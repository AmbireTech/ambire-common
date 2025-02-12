import { Banner } from '../../interfaces/banner';
import { EmailVaultData, MagicLinkFlow } from '../../interfaces/emailVault';
import { Fetch } from '../../interfaces/fetch';
import { Storage } from '../../interfaces/storage';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
import { KeystoreController } from '../keystore/keystore';
export declare enum EmailVaultState {
    Loading = "loading",
    WaitingEmailConfirmation = "WaitingEmailConfirmation",
    UploadingSecret = "UploadingSecret",
    Ready = "Ready"
}
export type MagicLinkKey = {
    key: string;
    expiry: Date;
    confirmed: boolean;
};
export type MagicLinkKeys = {
    [email: string]: MagicLinkKey;
};
export type SessionKeys = {
    [email: string]: string;
};
declare const STATUS_WRAPPED_METHODS: {
    readonly getEmailVaultInfo: "INITIAL";
    readonly uploadKeyStoreSecret: "INITIAL";
    readonly recoverKeyStore: "INITIAL";
    readonly requestKeysSync: "INITIAL";
    readonly finalizeSyncKeys: "INITIAL";
};
/**
 * EmailVaultController
 * @class
 * The purpose of this controller is to provide easy interface to the EmailVault, keystore and magic link libraries
 * The most important thing it achieves is handling magicLink and session keys with polling.
 * Emits the proper states e.g. loading, ready, awaiting email magicLink confirmation etc.
 * Extended documentation about the EV and its internal mechanisms
 * https://github.com/AmbireTech/ambire-common/wiki/Email-Vault-Documentation
 */
export declare class EmailVaultController extends EventEmitter {
    #private;
    private storage;
    private initialLoadPromise;
    isReady: boolean;
    lastUpdate: Date;
    emailVaultStates: {
        email: {
            [email: string]: EmailVaultData;
        };
        criticalError?: Error;
        errors?: Error[];
    };
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    constructor(storage: Storage, fetch: Fetch, relayerUrl: string, keyStore: KeystoreController, options?: {
        autoConfirmMagicLink?: boolean;
    });
    private load;
    get currentState(): EmailVaultState;
    handleMagicLinkKey(email: string, fn?: Function, flow?: MagicLinkFlow): Promise<void>;
    getMagicLinkKeyByEmail(email: string): MagicLinkKey | null;
    getEmailVaultInfo(email: string, flow?: MagicLinkFlow): Promise<void>;
    uploadKeyStoreSecret(email: string): Promise<void>;
    recoverKeyStore(email: string, newPassword: string): Promise<void>;
    requestKeysSync(email: string, keys: string[]): Promise<void>;
    finalizeSyncKeys(email: string, keys: string[], password: string): Promise<void>;
    fulfillSyncRequests(email: string, password: string): Promise<void>;
    cleanMagicAndSessionKeys(): Promise<void>;
    cancelEmailConfirmation(): void;
    dismissBanner(): void;
    get keystoreRecoveryEmail(): string | undefined;
    get hasKeystoreRecovery(): boolean;
    get hasConfirmedRecoveryEmail(): boolean;
    get banners(): Banner[];
    toJSON(): this & {
        currentState: EmailVaultState;
        hasKeystoreRecovery: boolean;
        hasConfirmedRecoveryEmail: boolean;
        banners: Banner[];
        keystoreRecoveryEmail: string | undefined;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=emailVault.d.ts.map