import { describe, expect, test } from '@jest/globals'
import { makeMainController } from '@test/helpers/mainController'

import { MainController } from './main'

type MainControllerProps = ConstructorParameters<typeof MainController>[0]

describe('MainController feature flags', () => {
  test('callers cannot set the starting feature flags', () => {
    // @ts-expect-error The props have no `featureFlags`, only a subclass can set the starting flags
    const featureFlags: MainControllerProps['featureFlags'] = {}

    expect(featureFlags).toEqual({})
  })

  test('starts with no flag values of its own, so production uses the defaults', () => {
    // The method does not use `this`, so there is no need to build a whole controller
    expect(MainController.prototype['getInitialFeatureFlags']()).toEqual({})
  })

  test('a subclass sets the starting flags that the constructor reads', async () => {
    const { mainCtrl } = await makeMainController(undefined, {
      overrides: { featureFlags: { gasTank: false } }
    })

    expect(mainCtrl.featureFlags.isFeatureEnabled('gasTank')).toBe(false)
    // The flags it did not set keep their defaults
    expect(mainCtrl.featureFlags.isFeatureEnabled('tokenPrices')).toBe(true)
  })

  test('the subclass of the test helper keeps the name of the controller', async () => {
    const { mainCtrl } = await makeMainController()

    expect(mainCtrl.name).toBe('MainController')
  })
})
