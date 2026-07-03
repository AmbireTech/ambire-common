import { MagicLinkKeys, SessionKeys } from '@/controllers/emailVault/emailVault'
import { Contacts } from '@/interfaces/addressBook'
import { EmailVaultData } from '@/interfaces/emailVault'

import { FeatureFlags } from '../consts/featureFlags'
import { SignedMessage } from '../controllers/activity/types'
import { SubmittedAccountOp, SubmittedAccountOpLike } from '../libs/accountOp/submittedAccountOp'
import { NetworksWithPositionsByAccounts } from '../libs/defiPositions/types'
import { CustomToken, TokenPreference } from '../libs/portfolio/customToken'
import {
  AccountAssetsState as PortfolioAccountAssetsState,
  LearnedAssets,
  PreviousHintsStorage,
  TokenBlacklist
} from '../libs/portfolio/interfaces'
import { Account, AccountId, AccountPreferences } from './account'
import { AutoLoginPoliciesByAccount, AutoLoginSettings } from './autoLogin'
import { Selectors } from './contractInfo'
import { ControllerInterface } from './controller'
import { Dapp, RecentDappEntry } from './dapp'
import { Domains } from './domains'
import { Key, MainKeyEncryptedWithSecret, StoredKey, StoredKeystoreSeed } from './keystore'
import { Network } from './network'
import { SwapAndBridgeActiveRoute } from './swapAndBridge'

export type IStorageController = ControllerInterface<
  InstanceType<typeof import('../controllers/storage/storage').StorageController>
>

export type StorageProps = {
  // Onboarding
  invite: object
  isSetupComplete: boolean
  onboardingState: object
  termsState: object
  themeType: string
  avatarType: string
  logLevel: string
  crashAnalyticsEnabledV2: boolean
  autoLockTime: number
  // Activity
  accountsOps: { [key: string]: { [key: string]: SubmittedAccountOp[] } }
  externalAccountOps: { [key: string]: { [key: string]: SubmittedAccountOpLike[] } }
  signedMessages: { [key: AccountId]: SignedMessage[] }
  // Migrations
  passedMigrations: string[]
  migrations: string[]
  // Keystore
  keyStoreUid: string | null
  keystoreSecrets: MainKeyEncryptedWithSecret[]
  keyPreferences: { addr: Key['addr']; type: Key['type']; label: string }[]
  keystoreKeys: StoredKey[]
  keystoreSeeds: StoredKeystoreSeed[]
  // Dapps
  dappsV2: Dapp[]
  dapps: Dapp[]
  recentDapps: RecentDappEntry[]
  // Selected account
  dismissedBanners: (string | number)[]
  selectedAccount: string | null
  selectedAccountDismissedBannerIds: { [key: string]: string[] }
  // Email vault
  emailVault: {
    email: { [email: string]: EmailVaultData }
    criticalError?: Error
    errors?: Error[]
  }
  sessionKeys: SessionKeys
  magicLinkKeys: MagicLinkKeys
  emailVaultSetupBannerDismissedAt: number
  // Portfolio
  tokenBlacklist: TokenBlacklist
  learnedAssets: LearnedAssets
  networksWithAssetsByAccount: { [accountId: string]: PortfolioAccountAssetsState }
  networksWithPositionsByAccounts: NetworksWithPositionsByAccounts
  tokenPreferences: TokenPreference[]
  customTokens: CustomToken[]
  previousHints: PreviousHintsStorage
  // Auto login
  autoLoginPolicies: AutoLoginPoliciesByAccount
  autoLoginSettings: AutoLoginSettings
  // Address book
  contacts: Contacts
  // Safe
  automaticallyResolvedSafeTxns: { nonce: bigint; txnIds: string[] }[]
  rejectedSafeTxns: string[]
  // Other
  signAccountOpFeeTokenPreference: {
    [chainId: string]: string | 'gasTank'
  }
  networks: { [key: string]: Network }
  accounts: Account[]
  networkPreferences: { [key: string]: Partial<Network> }
  accountPreferences: { [key: AccountId]: AccountPreferences }
  lastDappsUpdateVersion: string | null
  isPinned: boolean
  isPrivacyModeEnabled: boolean
  isSidePanelModeEnabled: boolean
  phishing: {
    version: number
    updatedAt: number
    domains: string[]
    addresses: string[]
  }
  swapAndBridgeActiveRoutes: SwapAndBridgeActiveRoute[]
  // Persisted reverse ENS/Namoshi lookup cache, kept indefinitely so accounts
  // don't need to be re-resolved after a service worker restart.
  domainsCache: Domains
  flags: Partial<FeatureFlags>
  isDefaultWallet: boolean
  shouldSkipTransactionQueuedModal: boolean
  isBatchingEnabled: boolean
  surveysRespondedTo: string[]
  functionSelectors: Selectors
  // Per-controller debug logging toggles. Only enabled ones are stored
  debugLogNamespaces: Record<string, boolean>
}

export interface Storage {
  // These typescript gymnastics are needed so:
  // 1. A warning is shown if a defaultValue is not provided (can be undefined)
  // 2. A warning is shown if a defaultValue is provided but is of the wrong type (can be StorageProps[K])
  // 3. A warning is shown if a defaultValue is explicitly set to null (can be StorageProps[K] or null), but
  // the same warning is not shown if a correct default value is provided
  get<K extends keyof StorageProps>(key: K): Promise<StorageProps[K] | undefined>
  get<K extends keyof StorageProps>(key: K, defaultValue: StorageProps[K]): Promise<StorageProps[K]>
  get<K extends keyof StorageProps>(key: K, defaultValue: null): Promise<StorageProps[K] | null>
  get<K extends keyof StorageProps>(
    key: K,
    defaultValue?: StorageProps[K] | null
  ): Promise<StorageProps[K] | null | undefined>
  set(key: string, value: any): Promise<null>
  remove(key: string): Promise<null>
}
