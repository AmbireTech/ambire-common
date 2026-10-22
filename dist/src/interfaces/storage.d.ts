import { MagicLinkKeys, SessionKeys } from '../controllers/emailVault/emailVault';
import { Contacts } from './addressBook';
import { EmailVaultData } from './emailVault';
import { FeatureFlags } from '../consts/featureFlags';
import { FeePayersHistory, SentToHistory, SignedMessage } from '../controllers/activity/types';
import { SubmittedAccountOp, SubmittedAccountOpLike } from '../libs/accountOp/submittedAccountOp';
import { NetworksWithPositionsByAccounts } from '../libs/defiPositions/types';
import { Erc7730PersistedRegistryCache } from '../libs/humanizer/erc7730/types';
import { CustomToken, TokenPreference } from '../libs/portfolio/customToken';
import { WalletStakingRelayerLog } from '../libs/walletStaking/pendingWithdrawal';
import { AccountAssetsState as PortfolioAccountAssetsState, LearnedAssets, PreviousHintsStorage, TokenBlacklist } from '../libs/portfolio/interfaces';
import { Account, AccountId, AccountPreferences } from './account';
import { AutoLoginPoliciesByAccount, AutoLoginSettings } from './autoLogin';
import { Selectors } from './contractInfo';
import { ControllerInterface } from './controller';
import { Dapp, RecentDappEntry, TrendingToken } from './dapp';
import { Domains } from './domains';
import { Key, MainKeyEncryptedWithSecret, StoredKey, StoredKeystoreSeed } from './keystore';
import { Network } from './network';
import { PrivacyPoolsAccount } from './privacyPools';
import { SwapAndBridgeActiveRoute } from './swapAndBridge';
import type { FeeSpeed } from './signAccountOp';
export type IStorageController = ControllerInterface<InstanceType<typeof import('../controllers/storage/storage').StorageController>>;
export type AutomaticallyResolvedSafeTxn = {
    accountAddr?: string;
    chainId?: bigint;
    nonce: bigint;
    txnIds: string[];
};
export type StorageProps = {
    invite: object;
    isSetupComplete: boolean;
    onboardingState: object;
    termsState: object;
    themeType: string;
    avatarType: string;
    logLevel: string;
    crashAnalyticsEnabledV2: boolean;
    autoLockTime: number;
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
    sentToHistory: SentToHistory;
    feePayersHistory: FeePayersHistory;
    /**
     * Which backend the transaction history was last written to. Recorded rather than a
     * "migrated" boolean because it says what is true rather than what happened: a session that
     * finds 'idb' here but cannot open IndexedDB knows the history exists and is unreachable,
     * which is indistinguishable from "no transactions yet" otherwise.
     */
    activityStorageBackend: 'idb' | 'keyValue';
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
    keystoreSeeds: StoredKeystoreSeed[];
    dappsV2: Dapp[];
    dapps: Dapp[];
    recentDapps: RecentDappEntry[];
    disguisedAsMetaMaskDapps: string[];
    trending: {
        updatedAt: number;
        tokens: TrendingToken[];
    };
    dismissedBanners: (string | number)[];
    selectedAccount: string | null;
    /** Seed id of the selected Privacy Pools account. Exclusive with `selectedAccount`. */
    selectedPrivacyPoolsAccount: string | null;
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
    automaticallyResolvedSafeTxns: AutomaticallyResolvedSafeTxn[];
    rejectedSafeTxns: string[];
    /**
     * The SDK's per-chain state as one blob, as the SDK invents its storage keys at runtime. Values
     * are serialized stores (megabytes each on mainnet) that spare a full rescan from deployment.
     */
    privacyPoolsState: {
        [key: string]: string;
    };
    /** The wallet's Privacy Pools accounts, at most one per stored recovery phrase. */
    privacyPoolsAccounts: PrivacyPoolsAccount[];
    signAccountOpFeeTokenPreference: {
        [chainId: string]: string | 'gasTank';
    };
    signAccountOpFeeSpeedPreference: {
        [chainId: string]: FeeSpeed;
    };
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
    isSidePanelModeEnabled: boolean;
    phishing: {
        version: number;
        updatedAt: number;
        domains: string[];
        addresses: string[];
    };
    swapAndBridgeActiveRoutes: SwapAndBridgeActiveRoute[];
    disabledSwapProviderIds: string[];
    domainsCache: Domains;
    erc7730RegistryCache: Erc7730PersistedRegistryCache;
    flags: Partial<FeatureFlags>;
    isDefaultWallet: boolean;
    shouldSkipTransactionQueuedModal: boolean;
    isBatchingEnabled: boolean;
    surveysRespondedTo: string[];
    functionSelectors: Selectors;
    debugLogNamespaces: Record<string, boolean>;
    walletStakingLeaveLogs: {
        [accountAddr: string]: WalletStakingRelayerLog[];
    };
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