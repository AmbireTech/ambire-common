import { FeatureFlags } from '../../consts/featureFlags'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'

/**
 * Calls `onChange` each time the flag is turned on or off. Not when the flags are loaded from
 * storage at startup, as that's what the flag was all along, not a change. Returns the function
 * that stops listening.
 */
export const onFeatureFlagChange = (
  featureFlags: IFeatureFlagsController,
  flag: keyof FeatureFlags,
  onChange: (isEnabled: boolean) => void
): (() => void) => {
  let wasEnabled = featureFlags.isFeatureEnabled(flag)

  return featureFlags.onUpdate(() => {
    const isEnabled = featureFlags.isFeatureEnabled(flag)
    if (isEnabled === wasEnabled) return

    wasEnabled = isEnabled
    // Loaded from storage at startup: nothing was shown with the default value yet
    if (featureFlags.initialLoadPromise) return

    onChange(isEnabled)
  })
}
