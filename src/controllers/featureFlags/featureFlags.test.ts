import { describe, expect, test } from '@jest/globals'

import { defaultFeatureFlags, FeatureFlags } from '../../consts/featureFlags'
import { FeatureFlagsController } from './featureFlags'

const makeStorage = (initialFlags?: Partial<FeatureFlags>) => {
  let storedFlags = initialFlags
  return {
    get: async (_key: string, defaultValue: any) => storedFlags ?? defaultValue,
    set: async (_key: string, value: Partial<FeatureFlags>) => {
      storedFlags = { ...value }
    },
    getStoredFlags: () => storedFlags
  }
}

const makeController = async (storage: ReturnType<typeof makeStorage>) => {
  const controller = new FeatureFlagsController({}, storage as any)
  await controller.initialLoadPromise
  return controller
}

// Simulates flags stored by an older wallet version that did not have `gnsDomains` yet
const getFlagsStoredBeforeGnsDomains = (
  newPrivacyFeaturesOffByDefault: boolean
): Partial<FeatureFlags> => {
  const { gnsDomains, ...flags } = { ...defaultFeatureFlags, newPrivacyFeaturesOffByDefault }
  return flags
}

describe('FeatureFlagsController', () => {
  test('new privacy opt-outs keep their default value when the setting is off', async () => {
    const storage = makeStorage(getFlagsStoredBeforeGnsDomains(false))
    const controller = await makeController(storage)

    expect(controller.flags.gnsDomains).toBe(true)
  })

  test('new privacy opt-outs are turned off when the setting is on', async () => {
    const storage = makeStorage(getFlagsStoredBeforeGnsDomains(true))
    const controller = await makeController(storage)

    expect(controller.flags.gnsDomains).toBe(false)
    expect(storage.getStoredFlags()?.gnsDomains).toBe(false)
  })

  test('stored privacy opt-outs and flags that are not privacy opt-outs do not change', async () => {
    const { withTransactionManagerController, ...storedFlags } = {
      ...defaultFeatureFlags,
      newPrivacyFeaturesOffByDefault: true
    }
    const storage = makeStorage(storedFlags)
    const controller = await makeController(storage)

    expect(controller.flags).toEqual({
      ...defaultFeatureFlags,
      newPrivacyFeaturesOffByDefault: true
    })
  })

  test('enabling the setting stores all current flags, so they are not new later', async () => {
    const storage = makeStorage()
    const controller = await makeController(storage)
    await controller.setFeatureFlags({ newPrivacyFeaturesOffByDefault: true })

    const controllerAfterReload = await makeController(storage)
    expect(controllerAfterReload.flags).toEqual({
      ...defaultFeatureFlags,
      newPrivacyFeaturesOffByDefault: true
    })
  })
})
