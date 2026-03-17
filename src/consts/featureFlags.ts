export interface FeatureFlags {
  withTransactionManagerController: boolean
  withEmailVaultController: boolean
  withContinuousUpdatesController: boolean
  testnetMode: boolean
  tokenAndDefiAutoDiscovery: boolean
}

export const defaultFeatureFlags: FeatureFlags = {
  withTransactionManagerController: false,
  withEmailVaultController: true,
  withContinuousUpdatesController: true,
  testnetMode: false,
  tokenAndDefiAutoDiscovery: true
}
