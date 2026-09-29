import { expect } from '@jest/globals'

import { predefinedDapps } from '../../consts/dapps/dapps'
import { Dapp } from '../../interfaces/dapp'
import {
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
})
