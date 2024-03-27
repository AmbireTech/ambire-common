/* eslint-disable @typescript-eslint/no-floating-promises */

import { describe, expect, test } from '@jest/globals'

import { Bundler } from './bundler'

describe('Settings Controller', () => {
  test('should check if the network is supported by the bundler', async () => {
    // it supports mantle
    const mantleShouldBeSupported = await Bundler.isNetworkSupported(5000n)
    expect(mantleShouldBeSupported).toBe(true)

    // it doesn't support filecoin
    const filecoinShouldNotBeSupported = await Bundler.isNetworkSupported(134n)
    expect(filecoinShouldNotBeSupported).toBe(false)
  })
})
