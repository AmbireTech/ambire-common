import { SignedMessage } from '../controllers/activity/types'
// eslint-disable-next-line import/no-cycle
import { StoredPhishingDetection } from '../controllers/phishing/phishing'
import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { NetworksWithPositionsByAccounts } from '../libs/defiPositions/types'
import { CustomToken, TokenPreference } from '../libs/portfolio/customToken'
import {
  AccountAssetsState as PortfolioAccountAssetsState,
  PreviousHintsStorage
} from '../libs/portfolio/interfaces'
import { Account, AccountId, AccountPreferences } from './account'
import { Dapp } from './dapp'
import { Key, KeystoreSeed, MainKeyEncryptedWithSecret, StoredKey } from './keystore'
import { Network } from './network'
import { CashbackStatusByAccount } from './selectedAccount'
import { SwapAndBridgeActiveRoute } from './swapAndBridge'

export type StorageProps = {
  passedMigrations: string[]
  migrations: string[]
  networks: { [key: string]: Network }
  accounts: Account[]
  networkPreferences?: { [key: string]: Partial<Network> }
  accountPreferences?: { [key: AccountId]: AccountPreferences }
  accountsOps: { [key: string]: { [key: string]: SubmittedAccountOp[] } }
  signedMessages: { [key: AccountId]: SignedMessage[] }
  networksWithAssetsByAccount: { [accountId: string]: PortfolioAccountAssetsState }
  networksWithPositionsByAccounts: NetworksWithPositionsByAccounts
  tokenPreferences: TokenPreference[]
  customTokens: CustomToken[]
  previousHints: PreviousHintsStorage
  keyPreferences: { addr: Key['addr']; type: Key['type']; label: string }[]
  keystoreKeys: StoredKey[]
  keystoreSeeds: KeystoreSeed[]
  cashbackStatusByAccount: CashbackStatusByAccount
  dapps: Dapp[]
  invite: object
  isPinned: boolean
  isSetupComplete: boolean
  keyStoreUid: string | null
  keystoreSecrets: MainKeyEncryptedWithSecret[]
  onboardingState?: object
  phishingDetection: StoredPhishingDetection
  selectedAccount: string | null
  swapAndBridgeActiveRoutes: SwapAndBridgeActiveRoute[]
  termsState?: object
}

export interface Storage {
  get<K extends keyof StorageProps | string | undefined>(
    key: K,
    defaultValue?: any
  ): Promise<K extends keyof StorageProps ? StorageProps[K] : any>
  set(key: string, value: any): Promise<null>
  remove(key: string): Promise<null>
}
