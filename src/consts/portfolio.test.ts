import { describe, expect, test } from '@jest/globals'

import { AMBIRE_API_TIMEOUT, getDiscoveryTimeout, MOBILE_DISCOVERY_TIMEOUT } from './portfolio'

describe('portfolio request budgets', () => {
  describe('getDiscoveryTimeout', () => {
    // The discovery response is hundreds of kilobytes and takes seconds, unlike every other
    // request to our APIs, and on mobile the positions it gives up on are gone until the
    // next update - there is nothing cached after a cold start to fall back on
    test('mobile gets a longer budget than the other requests do', () => {
      expect(getDiscoveryTimeout('mobile-ios')).toBe(MOBILE_DISCOVERY_TIMEOUT)
      expect(getDiscoveryTimeout('mobile-android')).toBe(MOBILE_DISCOVERY_TIMEOUT)
      expect(MOBILE_DISCOVERY_TIMEOUT).toBeGreaterThan(AMBIRE_API_TIMEOUT)
    })

    test('everywhere else it is the same budget as any other request', () => {
      expect(getDiscoveryTimeout('default')).toBe(AMBIRE_API_TIMEOUT)
      expect(getDiscoveryTimeout('browser-webkit')).toBe(AMBIRE_API_TIMEOUT)
      expect(getDiscoveryTimeout('browser-gecko')).toBe(AMBIRE_API_TIMEOUT)
    })

    // Every extra second here is a second of blank network, since the tokens are only
    // fetched once discovery answers
    test('the longer budget stays within a few seconds', () => {
      expect(MOBILE_DISCOVERY_TIMEOUT).toBeLessThanOrEqual(6000)
    })
  })
})
