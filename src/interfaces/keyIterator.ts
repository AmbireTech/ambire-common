import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'
import { SelectedAccountForImport } from './account'
import { ExternalSignerController, Key, ParsedQrAccount, QrProtocolType } from './keystore'

export type QrWalletConfig = {
  protocol: QrProtocolType
  label: string
  tutorialUrl?: string
}

export interface KeyIterator {
  type: Key['type']
  subType: 'seed' | 'private-key' | 'hw'
  /** The wallet native SDK instance, if any exists */
  walletSDK?: any
  /** Needed for the hardware wallets only */
  controller?: ExternalSignerController
  /**
   * Which of the offered derivation paths this wallet can browse. Wallets that hand
   * over a single extended public key (QR, NFC) are limited to the paths that branch
   * off it. Undefined means every path is available.
   */
  derivableHdPathTemplates?: HD_PATH_TEMPLATE_TYPE[]
  /** Retrieves the the public addresses (accounts) from specific indexes */
  retrieve: (
    fromToArr: { from: number; to: number }[],
    derivation?: HD_PATH_TEMPLATE_TYPE
  ) => Promise<string[]>
  /** Retrieves the private keys (optional, for hot wallets only) */
  retrieveInternalKeys?: (
    selectedAccountsForImport: SelectedAccountForImport[],
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE,
    keystoreKeys: Key[]
  ) => {
    addr: string
    type: 'internal'
    label: string
    privateKey: string
    dedicatedToOneSA: boolean
    meta: {
      createdAt: number
    }
  }[]
  /** Checks if the seed matches the key iterator's seed (optional, for hot wallets) */
  isSeedMatching?: (seedToCompareWith: string, passphraseToCompareWith: string | null) => boolean
  // QR-specific optional fields
  parsedAccount?: ParsedQrAccount
}
