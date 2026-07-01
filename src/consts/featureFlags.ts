export interface FeatureFlags {
  withTransactionManagerController: boolean
  withEmailVaultController: boolean
  withContinuousUpdatesController: boolean
  testnetMode: boolean
  tokenAndDefiAutoDiscovery: boolean
  apiForFunctionSelectors: boolean
  /**
   * Off by default for privacy: passively bulk-resolving ENS/Namoshi for all
   * accounts links them together. When enabled, the wallet keeps every account's
   * ENS profile fresh in the background (the pre-privacy behaviour).
   */
  keepEnsProfilesUpToDate: boolean
}

export const defaultFeatureFlags: FeatureFlags = {
  withTransactionManagerController: false,
  withEmailVaultController: true,
  withContinuousUpdatesController: true,
  testnetMode: false,
  tokenAndDefiAutoDiscovery: true,
  apiForFunctionSelectors: true,
  keepEnsProfilesUpToDate: false
}
