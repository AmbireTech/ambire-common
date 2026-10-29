import { expect } from '@jest/globals'

import {
  getImpersonation,
  IMPERSONATION_TARGETS,
  isWithinOneEdit,
  normalizeAppName
} from './impersonation'

const check = (
  hostname: string,
  {
    name,
    icon,
    isInAppCatalog = false
  }: { name?: string; icon?: string; isInAppCatalog?: boolean } = {}
) => getImpersonation({ hostname, name, icon, isInAppCatalog })

describe('impersonation', () => {
  describe('normalizeAppName', () => {
    it('ignores case, spaces and punctuation', () => {
      expect(normalizeAppName('Uniswap')).toBe('uniswap')
      expect(normalizeAppName('  UNISWAP ')).toBe('uniswap')
      expect(normalizeAppName('Magic Eden')).toBe('magiceden')
      expect(normalizeAppName('Revoke.cash')).toBe('revokecash')
      expect(normalizeAppName('Safe{Wallet}')).toBe('safe')
    })

    it('drops generic words from the end of the name', () => {
      expect(normalizeAppName('Uniswap Interface')).toBe('uniswap')
      expect(normalizeAppName('Lido Finance')).toBe('lido')
      expect(normalizeAppName('Rabby Wallet App')).toBe('rabby')
    })

    it('keeps a name made only of a generic word', () => {
      expect(normalizeAppName('App')).toBe('app')
      expect(normalizeAppName('Exchange')).toBe('exchange')
    })

    it('returns an empty string for a name without latin letters or digits', () => {
      expect(normalizeAppName('')).toBe('')
      expect(normalizeAppName('---')).toBe('')
    })
  })

  describe('isWithinOneEdit', () => {
    it('matches equal strings and strings one character apart', () => {
      expect(isWithinOneEdit('uniswap', 'uniswap')).toBe(true)
      expect(isWithinOneEdit('un1swap', 'uniswap')).toBe(true)
      expect(isWithinOneEdit('uniswapp', 'uniswap')).toBe(true)
      expect(isWithinOneEdit('unswap', 'uniswap')).toBe(true)
    })

    it('does not match strings two or more characters apart', () => {
      expect(isWithinOneEdit('un1swapp', 'uniswap')).toBe(false)
      expect(isWithinOneEdit('uniswapxx', 'uniswap')).toBe(false)
      expect(isWithinOneEdit('sushiswap', 'uniswap')).toBe(false)
    })
  })

  describe('getImpersonation', () => {
    it('does not flag the official domain of an app or its subdomains', () => {
      expect(check('uniswap.org', { name: 'Uniswap' })).toBeNull()
      expect(check('app.uniswap.org', { name: 'Uniswap Interface' })).toBeNull()
      expect(
        check('app.aave.com', { name: 'Aave', icon: 'https://app.aave.com/icon.svg' })
      ).toBeNull()
    })

    it('does not flag the old domain of an app that moved', () => {
      expect(check('app.1inch.io', { name: '1inch' })).toBeNull()
      expect(check('jumper.exchange', { name: 'Jumper' })).toBeNull()
      expect(check('curve.fi', { name: 'Curve' })).toBeNull()
      expect(check('compound.finance', { name: 'Compound' })).toBeNull()
    })

    it('does not flag sites from the app catalog', () => {
      expect(check('uniswap-fork.xyz', { name: 'Uniswap', isInAppCatalog: true })).toBeNull()
    })

    it('does not flag sites without a public domain, used by developers to run a copy of an app', () => {
      expect(check('localhost', { name: 'Uniswap' })).toBeNull()
      expect(check('127.0.0.1', { name: 'Uniswap' })).toBeNull()
    })

    it('does not flag unrelated sites', () => {
      expect(check('chainlist.org', { name: 'Chainlist' })).toBeNull()
      expect(check('example.com')).toBeNull()
      expect(
        check('example.com', { name: 'Swap', icon: 'https://example.com/favicon.ico' })
      ).toBeNull()
    })

    it('flags a site that uses the name of a known app', () => {
      expect(check('totally-legit.xyz', { name: 'Uniswap' })).toEqual({
        appName: 'Uniswap',
        appDomain: 'uniswap.org',
        reason: 'name'
      })
      expect(check('totally-legit.xyz', { name: 'Uniswap Interface' })?.reason).toBe('name')
      expect(check('totally-legit.xyz', { name: 'Sushi' })?.appName).toBe('SushiSwap')
      expect(check('totally-legit.xyz', { name: 'Safe{Wallet}' })?.appName).toBe('Safe')
    })

    it('does not flag a site whose name only contains the name of a known app', () => {
      expect(check('totally-legit.xyz', { name: 'Uniswap Analytics Dashboard' })).toBeNull()
      expect(check('totally-legit.xyz', { name: 'Safe Haven' })).toBeNull()
    })

    it('flags a site whose icon is loaded from the domain of a known app', () => {
      expect(
        check('totally-legit.xyz', {
          name: 'Totally Legit',
          icon: 'https://app.uniswap.org/favicon.png'
        })
      ).toEqual({ appName: 'Uniswap', appDomain: 'uniswap.org', reason: 'icon' })
    })

    it('reports the icon over the name, as it is the stronger signal', () => {
      expect(
        check('totally-legit.xyz', { name: 'Uniswap', icon: 'https://aave.com/favicon.ico' })
      ).toEqual({ appName: 'Aave', appDomain: 'aave.com', reason: 'icon' })
    })

    it('flags the same domain name with another ending', () => {
      expect(check('uniswap.app')?.reason).toBe('domain')
      expect(check('app.uniswap.finance')?.appName).toBe('Uniswap')
      expect(check('safe.xyz')?.appName).toBe('Safe')
    })

    it('flags a domain name one character off', () => {
      expect(check('un1swap.org')?.appName).toBe('Uniswap')
      expect(check('uniswapp.org')?.appName).toBe('Uniswap')
      expect(check('pancakeswep.finance')?.appName).toBe('PancakeSwap')
    })

    it('flags the domain name of an app with words added', () => {
      expect(check('uniswap-airdrop.com')?.appName).toBe('Uniswap')
      expect(check('claim-aave.com')?.appName).toBe('Aave')
    })

    it('does not fuzzy-match short domain names, as too many unrelated ones are one character off', () => {
      expect(check('gmc.io')).toBeNull()
      expect(check('thena.fi')).toBeNull()
      expect(check('9inch.io')).toBeNull()
      expect(check('pumper.money')).toBeNull()
    })

    it('only flags the exact name of apps named after a common word', () => {
      expect(check('safe-haven.com')).toBeNull()
      expect(check('curvy.finance')).toBeNull()
      expect(check('compound-interest.com')).toBeNull()
      expect(check('curve.io')?.appName).toBe('Curve')
    })

    it('can not be bypassed with a phishing domain that has the app domain as a subdomain', () => {
      expect(check('uniswap.org.totally-legit.xyz', { name: 'Uniswap' })?.reason).toBe('name')
    })

    it('can not be bypassed with uppercase letters in the icon url', () => {
      expect(
        check('totally-legit.xyz', { icon: 'https://APP.UNISWAP.ORG/favicon.png' })?.reason
      ).toBe('icon')
    })

    it('has valid targets', () => {
      for (const target of IMPERSONATION_TARGETS) {
        expect(target.domains.length).toBeGreaterThan(0)
        expect(normalizeAppName(target.name)).not.toBe('')
      }
    })
  })
})
