export interface FeatureFlags {
  [feature: string]: boolean
}

export const featureFlags: FeatureFlags = {
  eip7702: false || !!process.env.FEATURE_FLAG_EIP7702
}
