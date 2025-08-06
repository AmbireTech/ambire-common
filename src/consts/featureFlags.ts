export interface FeatureFlags {
  withTransactionManagerController: boolean
  withEmailVaultController: boolean
}

export const featureFlags: FeatureFlags = {
  withTransactionManagerController: false,
  withEmailVaultController: true
}
