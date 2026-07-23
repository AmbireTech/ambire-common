export interface FeatureFlags {
  withTransactionManagerController: boolean
  withEmailVaultController: boolean
  withContinuousUpdatesController: boolean
  testnetMode: boolean
  tokenAndDefiAutoDiscovery: boolean
  apiForFunctionSelectors: boolean
  /**
   * Allow the user to opt out of erc4337 which will automatically
   * disable paying gas in different tokens & gas tank.
   * For Ambire v2 accounts, it will also disalbe ETH payments (the user
   * will need an EOA account just like using a Safe)
   */
  erc4337: boolean
  /**
   * Off by default for privacy: passively bulk-resolving ENS/Namoshi for all
   * accounts links them together. When enabled, the wallet keeps every account's
   * ENS profile fresh in the background (the pre-privacy behaviour).
   */
  keepEnsProfilesUpToDate: boolean
  /** Resolve Namoshi names (.btc, .citrea) on Citrea. */
  namoshiDomains: boolean
  /** Resolve GNS names (.gwei) on Ethereum. */
  gnsDomains: boolean
}

export const defaultFeatureFlags: FeatureFlags = {
  withTransactionManagerController: false,
  withEmailVaultController: true,
  withContinuousUpdatesController: true,
  testnetMode: false,
  tokenAndDefiAutoDiscovery: true,
  apiForFunctionSelectors: true,
  erc4337: true,
  keepEnsProfilesUpToDate: false,
  // @TODO: Introduce a setting and flip to false
  namoshiDomains: true,
  gnsDomains: true
}
