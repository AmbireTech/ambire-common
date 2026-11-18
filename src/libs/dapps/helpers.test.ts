import { afterEach, beforeEach, expect } from '@jest/globals'
import { getDomain } from 'tldts'

import { predefinedDapps } from '../../consts/dapps/dapps'
import { Dapp } from '../../interfaces/dapp'
import {
  getAccountsForDapp,
  getCachedDomain,
  getDappIdFromUrl,
  getNormalizedHostnameFromUrl,
  getUnauthenticatedDapps,
  normalizeHostname,
  unifyDefiLlamaDappUrl,
  withoutUnusedAccountPreferences
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

  describe('url parsing cache', () => {
    const OriginalURL = globalThis.URL

    afterEach(() => {
      globalThis.URL = OriginalURL
    })

    it('parses a url once, however many times it is asked about', () => {
      let parseCount = 0
      globalThis.URL = class CountingURL extends OriginalURL {
        constructor(url: string | URL, base?: string | URL) {
          super(url, base)
          parseCount += 1
        }
      }
      const url = 'https://cache-once.example.com/path?x=1'

      expect(getNormalizedHostnameFromUrl(url)).toBe('cache-once.example.com')
      expect(getDappIdFromUrl(url)).toBe('cache-once.example.com')
      expect(unifyDefiLlamaDappUrl(url)).toBe('https://cache-once.example.com')

      expect(parseCount).toBe(1)
    })

    it('gives the same normalized result on a repeated call', () => {
      const url = 'https://www.Repeat.Example.com./'

      const first = getNormalizedHostnameFromUrl(url)
      const second = getNormalizedHostnameFromUrl(url)

      expect(first).toBe('www.repeat.example.com')
      expect(second).toBe(first)
      expect(getDappIdFromUrl(url)).toBe('repeat.example.com')
    })

    it('keeps reporting an unparsable url as unparsable', () => {
      expect(getNormalizedHostnameFromUrl('not a url')).toBeNull()
      expect(getNormalizedHostnameFromUrl('not a url')).toBeNull()
      expect(getDappIdFromUrl('not a url')).toBe('not a url')
      expect(unifyDefiLlamaDappUrl('not a url')).toBe('not a url')
    })

    it('does not let a cached url leak into a different one', () => {
      expect(getNormalizedHostnameFromUrl('https://app.uniswap.org/')).toBe('app.uniswap.org')
      expect(getNormalizedHostnameFromUrl('https://app.uniswap.org@evil.com/')).toBe('evil.com')
      expect(getNormalizedHostnameFromUrl('https://app.uniswap.org/')).toBe('app.uniswap.org')
    })

    it('still parses correctly once the cache has been emptied for growing too large', () => {
      for (let i = 0; i < 20_001; i++)
        getNormalizedHostnameFromUrl(`https://host-${i}.example.com/`)

      expect(getNormalizedHostnameFromUrl('https://host-0.example.com/')).toBe('host-0.example.com')
      expect(getNormalizedHostnameFromUrl('https://after-clear.example.com./')).toBe(
        'after-clear.example.com'
      )
    })
  })

  describe('hostname normalization behind a URL parser that does not follow the spec', () => {
    const OriginalURL = globalThis.URL

    // Like React Native's polyfill: the hostname comes back as typed - case, unicode and
    // ideographic full stops included
    class AsTypedHostnameURL {
      hostname: string

      origin: string

      constructor(url: string) {
        const [scheme, rest = ''] = url.split('://')
        if (!rest) throw new TypeError(`Invalid URL: ${url}`)

        this.hostname = rest.split('/')[0]!
        this.origin = `${scheme}://${this.hostname}`
      }
    }

    beforeEach(() => {
      globalThis.URL = AsTypedHostnameURL as unknown as typeof URL
    })

    afterEach(() => {
      globalThis.URL = OriginalURL
    })

    it('lowercases an ASCII hostname', () => {
      expect(getNormalizedHostnameFromUrl('https://ExAmple.WEB.App./as-typed-1')).toBe(
        'example.web.app'
      )
    })

    it('converts an internationalized hostname to punycode, whatever its case', () => {
      expect(getNormalizedHostnameFromUrl('https://пример.бг./as-typed-2')).toBe(
        'xn--e1afmkfd.xn--90ae'
      )
      expect(getNormalizedHostnameFromUrl('https://ПРИМЕР.БГ/as-typed-3')).toBe(
        'xn--e1afmkfd.xn--90ae'
      )
    })

    it('treats ideographic full stops as dots', () => {
      expect(getNormalizedHostnameFromUrl('https://example。web。app。/as-typed-4')).toBe(
        'example.web.app'
      )
    })

    it('SECURITY: folds full-width look-alike letters, so they cannot dodge the phishing list', () => {
      expect(getNormalizedHostnameFromUrl('https://ＥＶＩＬ.com/as-typed-5')).toBe('evil.com')
    })

    it('gives the same dApp id as a spec-compliant parser', () => {
      expect(getDappIdFromUrl('https://WWW.Uniswap.ORG/as-typed-6')).toBe('uniswap.org')
    })
  })

  describe('unifyDefiLlamaDappUrl', () => {
    it('reduces a url to its origin', () => {
      expect(unifyDefiLlamaDappUrl('https://app.aave.com/markets?x=1')).toBe('https://app.aave.com')
      expect(unifyDefiLlamaDappUrl('https://app.aave.com:8443/')).toBe('https://app.aave.com:8443')
    })
  })

  describe('getCachedDomain', () => {
    it('matches tldts for urls and hostnames, on the first call and the cached one', () => {
      const inputs = [
        'https://app.aave.com/markets',
        'app.aave.com',
        'my-dapp.vercel.app',
        'https://foo.bar.co.uk/',
        'localhost',
        'not a url'
      ]

      inputs.forEach((input) => {
        expect(getCachedDomain(input)).toBe(getDomain(input))
        expect(getCachedDomain(input)).toBe(getDomain(input))
      })
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

  describe('withoutUnusedAccountPreferences', () => {
    const PICKED = '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
    const OTHER = '0x4AA524DDa82630cE769e5C9d7ec7a45B94a41bc6'

    it('drops preferences that let the dapp see every account without pinning one', () => {
      expect(
        withoutUnusedAccountPreferences({
          enabled: false,
          selectedAccount: PICKED,
          accounts: [PICKED, OTHER]
        })
      ).toBeUndefined()
      expect(
        withoutUnusedAccountPreferences({
          enabled: false,
          selectedAccount: PICKED,
          accounts: [PICKED],
          isSelectedAccountPinned: false
        })
      ).toBeUndefined()
    })

    it('keeps preferences that limit the accounts the dapp may see', () => {
      const preferences = { enabled: true, selectedAccount: PICKED, accounts: [PICKED] }

      expect(withoutUnusedAccountPreferences(preferences)).toBe(preferences)
    })

    it('keeps preferences that pin an account for a dapp that may see every account', () => {
      const preferences = {
        enabled: false,
        selectedAccount: PICKED,
        accounts: [PICKED],
        isSelectedAccountPinned: true
      }

      expect(withoutUnusedAccountPreferences(preferences)).toBe(preferences)
    })

    it('returns undefined without preferences', () => {
      expect(withoutUnusedAccountPreferences(undefined)).toBeUndefined()
    })
  })
})
