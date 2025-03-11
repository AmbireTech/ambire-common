export interface FeatureFlags {
  eip7702: boolean
}

export const featureFlags: FeatureFlags = {
  eip7702: false || process.env.FEATURE_FLAG_EIP7702 === 'true'
}
