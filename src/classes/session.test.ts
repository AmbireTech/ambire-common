import { expect } from '@jest/globals'

import { getSessionConnectionSource, Session } from './session'

describe('getSessionConnectionSource', () => {
  test('a session without a WalletConnect topic is injected', () => {
    expect(getSessionConnectionSource({})).toBe('injected')
    // The in-app flag alone must not turn an injected session into a WalletConnect one
    expect(getSessionConnectionSource({ isWcFromInAppBrowser: true })).toBe('injected')
  })

  test('a WalletConnect session is wc unless paired from the in-app browser', () => {
    expect(getSessionConnectionSource({ wcTopic: 'topic' })).toBe('wc')
    expect(getSessionConnectionSource({ wcTopic: 'topic', isWcFromInAppBrowser: false })).toBe('wc')
    expect(getSessionConnectionSource({ wcTopic: 'topic', isWcFromInAppBrowser: true })).toBe(
      'wc-in-app'
    )
  })
})

describe('Session', () => {
  test('keeps the in-app flag only for WalletConnect sessions', () => {
    const injected = new Session({ url: 'https://aave.com', tabId: 1, isWcFromInAppBrowser: true })
    expect(injected.isWcFromInAppBrowser).toBe(false)
    expect(getSessionConnectionSource(injected)).toBe('injected')

    const inApp = new Session({
      url: 'https://aave.com',
      tabId: 2,
      wcTopic: 'topic',
      isWcFromInAppBrowser: true
    })
    expect(inApp.isWcFromInAppBrowser).toBe(true)
    expect(getSessionConnectionSource(inApp)).toBe('wc-in-app')

    const external = new Session({ url: 'https://aave.com', tabId: 3, wcTopic: 'topic' })
    expect(external.isWcFromInAppBrowser).toBe(false)
    expect(getSessionConnectionSource(external)).toBe('wc')
  })
})
