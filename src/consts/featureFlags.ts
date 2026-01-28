export interface FeatureFlags {
  withTransactionManagerController: boolean
  withEmailVaultController: boolean
  testnetMode: boolean
  tokenAndDefiAutoDiscovery: boolean
}

export const defaultFeatureFlags: FeatureFlags = {
  withTransactionManagerController: false,
  withEmailVaultController: true,
  testnetMode: false,
  tokenAndDefiAutoDiscovery: true
}
