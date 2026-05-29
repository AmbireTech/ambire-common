import { MagicLinkKeys, SessionKeys } from '../controllers/emailVault/emailVault';
import { Contacts } from './addressBook';
import { EmailVaultData } from './emailVault';
import { FeatureFlags } from '../consts/featureFlags';
import { SignedMessage } from '../controllers/activity/types';
import { SubmittedAccountOp, SubmittedAccountOpLike } from '../libs/accountOp/submittedAccountOp';
import { NetworksWithPositionsByAccounts } from '../libs/defiPositions/types';
import { CustomToken, TokenPreference } from '../libs/portfolio/customToken';
import { AccountAssetsState as PortfolioAccountAssetsState, LearnedAssets, PreviousHintsStorage, TokenBlacklist } from '../libs/portfolio/interfaces';
import { Account, AccountId, AccountPreferences } from './account';
import { AutoLoginPoliciesByAccount, AutoLoginSettings } from './autoLogin';
import { Selectors } from './contractInfo';
import { ControllerInterface } from './controller';
import { Dapp, RecentDappEntry } from './dapp';
import { Key, KeystoreSeed, MainKeyEncryptedWithSecret, StoredKey } from './keystore';
import { Network } from './network';
import { SwapAndBridgeActiveRoute } from './swapAndBridge';
export type IStorageController = ControllerInterface<InstanceType<typeof import('../controllers/storage/storage').StorageController>>;
export type StorageProps = {
    invite: object;
    isSetupComplete: boolean;
    onboardingState: object;
    termsState: object;
    accountsOps: {
        [key: string]: {
            [key: string]: SubmittedAccountOp[];
        };
    };
    externalAccountOps: {
        [key: string]: {
            [key: string]: SubmittedAccountOpLike[];
        };
    };
    signedMessages: {
        [key: AccountId]: SignedMessage[];
    };
    passedMigrations: string[];
    migrations: string[];
    keyStoreUid: string | null;
    keystoreSecrets: MainKeyEncryptedWithSecret[];
    keyPreferences: {
        addr: Key['addr'];
        type: Key['type'];
        label: string;
    }[];
    keystoreKeys: StoredKey[];
    keystoreSeeds: KeystoreSeed[];
    dappsV2: Dapp[];
    dapps: Dapp[];
    recentDapps: RecentDappEntry[];
    dismissedBanners: (string | number)[];
    selectedAccount: string | null;
    selectedAccountDismissedBannerIds: {
        [key: string]: string[];
    };
    emailVault: {
        email: {
            [email: string]: EmailVaultData;
        };
        criticalError?: Error;
        errors?: Error[];
    };
    sessionKeys: SessionKeys;
    magicLinkKeys: MagicLinkKeys;
    emailVaultSetupBannerDismissedAt: number;
    tokenBlacklist: TokenBlacklist;
    learnedAssets: LearnedAssets;
    networksWithAssetsByAccount: {
        [accountId: string]: PortfolioAccountAssetsState;
    };
    networksWithPositionsByAccounts: NetworksWithPositionsByAccounts;
    tokenPreferences: TokenPreference[];
    customTokens: CustomToken[];
    previousHints: PreviousHintsStorage;
    autoLoginPolicies: AutoLoginPoliciesByAccount;
    autoLoginSettings: AutoLoginSettings;
    contacts: Contacts;
    automaticallyResolvedSafeTxns: {
        nonce: bigint;
        txnIds: string[];
    }[];
    rejectedSafeTxns: string[];
    networks: {
        [key: string]: Network;
    };
    accounts: Account[];
    networkPreferences: {
        [key: string]: Partial<Network>;
    };
    accountPreferences: {
        [key: AccountId]: AccountPreferences;
    };
    lastDappsUpdateVersion: string | null;
    isPinned: boolean;
    isPrivacyModeEnabled: boolean;
    phishing: {
        version: number;
        updatedAt: number;
        domains: string[];
        addresses: string[];
    };
    swapAndBridgeActiveRoutes: SwapAndBridgeActiveRoute[];
    flags: Partial<FeatureFlags>;
    isDefaultWallet: boolean;
    shouldSkipTransactionQueuedModal: boolean;
    isBatchingEnabled: boolean;
    surveysRespondedTo: string[];
    functionSelectors: Selectors;
};
export interface Storage {
    get<K extends keyof StorageProps>(key: K): Promise<StorageProps[K] | undefined>;
    get<K extends keyof StorageProps>(key: K, defaultValue: StorageProps[K]): Promise<StorageProps[K]>;
    get<K extends keyof StorageProps>(key: K, defaultValue: null): Promise<StorageProps[K] | null>;
    get<K extends keyof StorageProps>(key: K, defaultValue?: StorageProps[K] | null): Promise<StorageProps[K] | null | undefined>;
    set(key: string, value: any): Promise<null>;
    remove(key: string): Promise<null>;
}
//# sourceMappingURL=storage.d.ts.map