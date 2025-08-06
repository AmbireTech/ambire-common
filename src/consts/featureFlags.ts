export interface FeatureFlags {
  withTransactionManagerController: boolean
  withEmailVaultController: boolean
  testnetMode: boolean
}

export const featureFlags: FeatureFlags = {
  withTransactionManagerController: false,
  withEmailVaultController: true,
  testnetMode: false
}
