import { expect } from '@jest/globals'

import { predefinedDapps } from '../../consts/dapps/dapps'
import { Dapp } from '../../interfaces/dapp'
import {
  getAccountsForDapp,
  getDappIdFromUrl,
  getNormalizedHostnameFromUrl,
  getUnauthenticatedDapps,
  normalizeHostname
} from './helpers'

describe('dapps helpers', () => {
  describe('normalizeHostname', () => {
    it('strips the trailing dot of a fully-qualified hostname', () => {
      expect(normalizeHostname('example.web.app.')).toBe('example.web.app')
      expect(normalizeHostname('app.aave.com.')).toBe('app.aave.com')
    })

    it('strips repeated trailing dots', () => {
      expect(normalizeHostname('example.web.app..')).toBe('example.web.app')
      expect(normalizeHostname('example.web.app...')).toBe('example.web.app')
    })

    it('leaves an already canonical hostname untouched', () => {
      expect(normalizeHostname('app.aave.com')).toBe('app.aave.com')
      expect(normalizeHostname('localhost')).toBe('localhost')
      expect(normalizeHostname('127.0.0.1')).toBe('127.0.0.1')
      expect(normalizeHostname('')).toBe('')
    })

    it('does not touch dots that are not trailing', () => {
      expect(normalizeHostname('sites.google.com')).toBe('sites.google.com')
    })
  })

  describe('getNormalizedHostnameFromUrl', () => {
    it('returns the canonical hostname of a fully-qualified host', () => {
      expect(getNormalizedHostnameFromUrl('https://example.web.app./')).toBe('example.web.app')
      expect(getNormalizedHostnameFromUrl('https://example.web.app./claim?ref=1')).toBe(
        'example.web.app'
      )
      expect(getNormalizedHostnameFromUrl('https://example.web.app.:8443/claim')).toBe(
        'example.web.app'
      )
    })

    it('normalizes casing and the ideographic full stop the URL parser maps to a dot', () => {
      expect(getNormalizedHostnameFromUrl('https://ExAmple.WEB.App./')).toBe('example.web.app')
      expect(getNormalizedHostnameFromUrl('https://example。web。app。/')).toBe('example.web.app')
    })

    it('keeps internationalized hostnames in punycode, as the phishing lists store them', () => {
      expect(getNormalizedHostnameFromUrl('https://пример.бг./')).toBe('xn--e1afmkfd.xn--90ae')
      expect(getNormalizedHostnameFromUrl('https://xn--e1afmkfd.xn--90ae./')).toBe(
        'xn--e1afmkfd.xn--90ae'
      )
    })

    it('ignores the userinfo part instead of reading it as the host', () => {
      expect(getNormalizedHostnameFromUrl('https://app.uniswap.org@evil.com/')).toBe('evil.com')
    })

    it('returns null for urls the parser rejects', () => {
      expect(getNormalizedHostnameFromUrl('not a url')).toBe(null)
      expect(getNormalizedHostnameFromUrl('')).toBe(null)
    })
  })

  describe('getDappIdFromUrl', () => {
    it('resolves a fully-qualified host to the same id as its canonical form', () => {
      expect(getDappIdFromUrl('https://example.web.app./')).toBe('example.web.app')
      expect(getDappIdFromUrl('https://example.web.app./')).toBe(
        getDappIdFromUrl('https://example.web.app/')
      )
      expect(getDappIdFromUrl('https://app.aave.com.')).toBe('app.aave.com')
    })

    it('strips every leading www., not just the first one', () => {
      expect(getDappIdFromUrl('https://www.www.aave.com')).toBe('aave.com')
      expect(getDappIdFromUrl('https://www.www.www.aave.com')).toBe('aave.com')
    })

    it('strips www. from a fully-qualified host as well', () => {
      expect(getDappIdFromUrl('https://www.example.web.app./')).toBe('example.web.app')
    })

    it('keeps resolving the existing cases', () => {
      expect(getDappIdFromUrl('https://app.uniswap.org/swap')).toBe('app.uniswap.org')
      expect(getDappIdFromUrl('https://www.aave.com')).toBe('aave.com')
      expect(getDappIdFromUrl('internal')).toBe('internal')
      expect(getDappIdFromUrl('')).toBe('internal')
    })

    it('still returns predefined ids by url', () => {
      const predefinedDapp = predefinedDapps[0]
      expect(getDappIdFromUrl(predefinedDapp.url)).toBe(predefinedDapp.id)
    })

    it('falls back to the raw input when it is not a url', () => {
      expect(getDappIdFromUrl('not a url')).toBe('not a url')
    })
  })

  describe('getUnauthenticatedDapps', () => {
    const dapp = (id: string, signingAuthenticated?: boolean) =>
      ({ id, name: `Dapp ${id}`, url: `https://${id}`, signingAuthenticated }) as Dapp

    it('returns the dapps not yet confirmed for, as id and name only', () => {
      expect(getUnauthenticatedDapps([dapp('a.com'), dapp('b.com', false)])).toEqual([
        { id: 'a.com', name: 'Dapp a.com' },
        { id: 'b.com', name: 'Dapp b.com' }
      ])
    })

    it('leaves out dapps already confirmed for', () => {
      expect(getUnauthenticatedDapps([dapp('a.com', true), dapp('b.com')])).toEqual([
        { id: 'b.com', name: 'Dapp b.com' }
      ])
    })

    it('skips dapps the catalog does not know, as the confirmation cannot be remembered', () => {
      expect(getUnauthenticatedDapps([undefined, dapp('a.com'), undefined])).toEqual([
        { id: 'a.com', name: 'Dapp a.com' }
      ])
    })

    it('dedupes a dapp behind several calls, keeping the first-seen order', () => {
      expect(getUnauthenticatedDapps([dapp('b.com'), dapp('a.com'), dapp('b.com')])).toEqual([
        { id: 'b.com', name: 'Dapp b.com' },
        { id: 'a.com', name: 'Dapp a.com' }
      ])
    })

    it('returns nothing for no dapps', () => {
      expect(getUnauthenticatedDapps([])).toEqual([])
    })
  })

  describe('getAccountsForDapp', () => {
    const WALLET = '0x16c81367c30c71d6B712355255A07FCe8fd3b5bB'
    const PICKED = '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
    const OTHER = '0x4AA524DDa82630cE769e5C9d7ec7a45B94a41bc6'

    it('follows the wallet account when the dapp may see it and nothing is pinned', () => {
      expect(
        getAccountsForDapp(
          { enabled: true, selectedAccount: PICKED, accounts: [PICKED, WALLET] },
          WALLET
        )
      ).toEqual([WALLET, PICKED])
    })

    it('keeps the last used account when the dapp may not see the wallet account', () => {
      expect(
        getAccountsForDapp(
          { enabled: true, selectedAccount: PICKED, accounts: [PICKED, OTHER] },
          WALLET
        )
      ).toEqual([PICKED, OTHER])
    })

    it('puts the pinned account first even when the dapp may see the wallet account', () => {
      expect(
        getAccountsForDapp(
          {
            enabled: true,
            selectedAccount: PICKED,
            accounts: [WALLET, PICKED, OTHER],
            isSelectedAccountPinned: true
          },
          WALLET
        )
      ).toEqual([PICKED, WALLET, OTHER])
    })

    it('returns only the pinned account to a dapp that may see every account', () => {
      expect(
        getAccountsForDapp(
          {
            enabled: false,
            selectedAccount: PICKED,
            accounts: [WALLET, PICKED],
            isSelectedAccountPinned: true
          },
          WALLET
        )
      ).toEqual([PICKED])
    })

    it('ignores a pinned account the dapp may no longer see', () => {
      expect(
        getAccountsForDapp(
          {
            enabled: true,
            selectedAccount: PICKED,
            accounts: [WALLET, OTHER],
            isSelectedAccountPinned: true
          },
          WALLET
        )
      ).toEqual([WALLET, OTHER])
    })

    it('follows the wallet account without preferences', () => {
      expect(getAccountsForDapp(undefined, WALLET)).toEqual([WALLET])
      expect(getAccountsForDapp(undefined, undefined)).toEqual([])
    })
  })
})
