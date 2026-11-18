import { expect } from '@jest/globals'

import type { ConnectedApp } from './impersonation'
import {
  decodePunycodeLabel,
  getImpersonation,
  IMPERSONATION_TARGETS,
  isWithinOneEdit,
  normalizeAppName,
  toLatinLookalikes
} from './impersonation'

const check = (
  hostname: string,
  {
    name,
    icon,
    isInAppCatalog = false,
    connectedApps
  }: {
    name?: string
    icon?: string
    isInAppCatalog?: boolean
    connectedApps?: ConnectedApp[]
  } = {}
) => getImpersonation({ hostname, name, icon, isInAppCatalog, connectedApps })

const BITREFILL: ConnectedApp = { name: 'Bitrefill', url: 'https://www.bitrefill.com' }

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

  describe('toLatinLookalikes', () => {
    it('replaces cyrillic and greek letters that look like latin ones', () => {
      expect(toLatinLookalikes('uniswаp')).toBe('uniswap') // cyrillic "а"
      expect(toLatinLookalikes('οpensea')).toBe('opensea') // greek "ο"
      expect(toLatinLookalikes('сurve')).toBe('curve') // cyrillic "с"
    })

    it('drops accents', () => {
      expect(toLatinLookalikes('unìswap')).toBe('uniswap')
      expect(toLatinLookalikes('ÜNISWAP')).toBe('uniswap')
    })

    it('keeps latin text as it is, only lowercased', () => {
      expect(toLatinLookalikes('Uniswap-App 2')).toBe('uniswap-app 2')
    })
  })

  describe('decodePunycodeLabel', () => {
    it('decodes the punycode form of a domain label', () => {
      expect(decodePunycodeLabel('uniswp-7nf')).toBe('uniswаp') // cyrillic "а"
      expect(decodePunycodeLabel('mnchen-3ya')).toBe('münchen')
      expect(decodePunycodeLabel('t1a')).toBe('ф')
    })

    it('returns null for an invalid label', () => {
      expect(decodePunycodeLabel('zz')).toBeNull()
      expect(decodePunycodeLabel('abc-!!')).toBeNull()
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
        reason: 'name',
        isConnectedApp: false
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
      ).toEqual({
        appName: 'Uniswap',
        appDomain: 'uniswap.org',
        reason: 'icon',
        isConnectedApp: false
      })
    })

    it('reports the icon over the name, as it is the stronger signal', () => {
      expect(
        check('totally-legit.xyz', { name: 'Uniswap', icon: 'https://aave.com/favicon.ico' })
      ).toEqual({ appName: 'Aave', appDomain: 'aave.com', reason: 'icon', isConnectedApp: false })
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

    it('flags the name of the app with bait words around it', () => {
      expect(check('totally-legit.xyz', { name: 'Uniswap Airdrop' })?.appName).toBe('Uniswap')
      expect(check('totally-legit.xyz', { name: 'Claim | Uniswap' })?.appName).toBe('Uniswap')
      expect(check('totally-legit.xyz', { name: 'Uniswap V4' })?.appName).toBe('Uniswap')
      expect(check('totally-legit.xyz', { name: 'Lido Finance Rewards' })?.appName).toBe('Lido')
    })

    it('does not flag third-party tools that mention an app', () => {
      expect(check('bridge.example.com', { name: 'Arbitrum Bridge' })).toBeNull()
      expect(check('vision.example.com', { name: 'ENS Vision' })).toBeNull()
      expect(check('defisaver.com', { name: 'Aave Dashboard by DeFi Saver' })).toBeNull()
    })

    it('does not flag apps named after a common word with bait words around them', () => {
      expect(check('totally-legit.xyz', { name: 'Safe Rewards' })).toBeNull()
      expect(check('totally-legit.xyz', { name: 'Curve Airdrop' })).toBeNull()
    })

    it('flags a domain with letters from other alphabets', () => {
      const cyrillicA = new URL('https://uniswаp.org').hostname
      expect(cyrillicA).toBe('xn--uniswp-7nf.org')
      expect(check(cyrillicA)).toEqual({
        appName: 'Uniswap',
        appDomain: 'uniswap.org',
        reason: 'domain',
        isConnectedApp: false
      })
      expect(check(new URL('https://οpensea.io').hostname)?.appName).toBe('OpenSea')
      expect(check(new URL('https://unìswap.org').hostname)?.appName).toBe('Uniswap')
      // Common words are matched exactly, but only after the lookalike letters are replaced
      expect(check(new URL('https://сurve.fi').hostname)?.appName).toBe('Curve')
    })

    it('flags a name with letters from other alphabets', () => {
      expect(check('totally-legit.xyz', { name: 'Uniswаp' })?.reason).toBe('name')
    })

    it('does not flag unrelated domains with letters from other alphabets', () => {
      expect(check('xn--80ak6aa92e.com')).toBeNull()
      expect(check('xn--mnchen-3ya.de')).toBeNull()
    })

    it('flags lookalike domains on shared hosting', () => {
      expect(check('uniswap-claim.vercel.app')?.reason).toBe('domain')
      expect(check('opensea.github.io')?.reason).toBe('domain')
      expect(check('my-project.vercel.app')).toBeNull()
    })

    it('never treats a site on shared hosting as the app itself', () => {
      expect(check('uniswap.vercel.app', { name: 'Uniswap' })?.reason).toBe('name')
    })

    it('does not flag the official domains apps redirect from', () => {
      expect(check('etherscan.com', { name: 'Etherscan' })).toBeNull()
      expect(check('pancakeswap.com', { name: 'PancakeSwap' })).toBeNull()
      expect(check('yearn.finance', { name: 'Yearn' })).toBeNull()
      expect(check('polymarket.us', { name: 'Polymarket' })).toBeNull()
      expect(check('app.hyperliquid-testnet.xyz', { name: 'Hyperliquid' })).toBeNull()
    })

    it('flags a domain with the app name glued to other words', () => {
      expect(check('metamaskcrypto.vip')?.appName).toBe('MetaMask')
      expect(check('wwwuniswap.com')?.appName).toBe('Uniswap')
      expect(check('claimeigenlayer.xyz')?.appName).toBe('EigenLayer')
    })

    it('does not look for short app names inside other words', () => {
      expect(check('j-morphology.com')).toBeNull()
      expect(check('parajumpers.it')).toBeNull()
      expect(check('pendleton-usa.com')).toBeNull()
      expect(check('goethena.com')).toBeNull()
    })

    it('flags a subdomain with the app name', () => {
      expect(check('uniswap.web3kit.space')).toEqual({
        appName: 'Uniswap',
        appDomain: 'uniswap.org',
        reason: 'domain',
        isConnectedApp: false
      })
      expect(check('lido.en-us.io')?.appName).toBe('Lido')
      expect(check('aave-claim.example.com')?.appName).toBe('Aave')
      expect(check('claimuniswap.example.com')?.appName).toBe('Uniswap')
      expect(check('rabby.io.wallet-connect.xyz')?.appName).toBe('Rabby')
      expect(check('mint.xn--pensea-h0e.example.com')?.appName).toBe('OpenSea') // greek "ο"
    })

    it('does not look for short or common app names in subdomains', () => {
      expect(check('gmx.example.com')).toBeNull()
      expect(check('ens.example.com')).toBeNull()
      expect(check('cow.example.com')).toBeNull()
      expect(check('safe.example.com')).toBeNull()
      expect(check('curve.example.com')).toBeNull()
    })

    it('does not flag subdomains of the app itself', () => {
      expect(check('uniswap.app.uniswap.org')).toBeNull()
      expect(check('docs.opensea.io')).toBeNull()
    })

    describe('connected apps', () => {
      const connectedApps = [BITREFILL]

      it('flags a lookalike of a connected app', () => {
        expect(check('bitrefill.app', { connectedApps })).toEqual({
          appName: 'Bitrefill',
          appDomain: 'bitrefill.com',
          reason: 'domain',
          isConnectedApp: true
        })
        expect(check('bitrefill-promo.com', { connectedApps })?.reason).toBe('domain')
        expect(check('bitrefil.com', { connectedApps })?.reason).toBe('domain')
        expect(check(new URL('https://bitrеfill.com').hostname, { connectedApps })?.reason).toBe(
          'domain'
        ) // cyrillic "е"
      })

      it('does not flag a lookalike of an app the user is not connected to', () => {
        expect(check('bitrefill.app')).toBeNull()
      })

      it('flags a site with the exact name of a connected app', () => {
        expect(check('totally-legit.xyz', { name: 'Bitrefill', connectedApps })?.reason).toBe(
          'name'
        )
      })

      it('does not flag the name of a connected app with bait words around it', () => {
        expect(check('totally-legit.xyz', { name: 'Bitrefill Rewards', connectedApps })).toBeNull()
      })

      it('flags a site that uses the icon of a connected app', () => {
        expect(
          check('totally-legit.xyz', {
            icon: 'https://www.bitrefill.com/favicon.ico',
            connectedApps
          })?.reason
        ).toBe('icon')
      })

      it('does not flag another subdomain of a connected app', () => {
        expect(check('shop.bitrefill.com', { name: 'Bitrefill', connectedApps })).toBeNull()
      })

      it('does not flag catalog apps', () => {
        expect(
          check('bitrefill.app', { name: 'Bitrefill', connectedApps, isInAppCatalog: true })
        ).toBeNull()
      })

      it('skips connected apps whose name does not match their domain', () => {
        const apps = [{ name: 'Dashboard', url: 'https://my-portfolio.xyz' }]
        expect(check('totally-legit.xyz', { name: 'Dashboard', connectedApps: apps })).toBeNull()
      })

      it('skips connected apps with a short name', () => {
        const apps = [{ name: 'Swap', url: 'https://swap.io' }]
        expect(check('swap.xyz', { name: 'Swap', connectedApps: apps })).toBeNull()
      })

      it('only flags short connected app domains with another ending', () => {
        const apps = [{ name: 'Morph', url: 'https://morph.network' }]
        expect(check('morph.xyz', { connectedApps: apps })?.appName).toBe('Morph')
        expect(check('morph-labs.com', { connectedApps: apps })).toBeNull()
        expect(check('morphe.network', { connectedApps: apps })).toBeNull()
        expect(check('morphology.com', { connectedApps: apps })).toBeNull()
        expect(check('morph.web3kit.space', { connectedApps: apps })).toBeNull()
      })

      it('flags a connected app name glued to other words or in a subdomain', () => {
        expect(check('bitrefillpromo.com', { connectedApps })?.appName).toBe('Bitrefill')
        expect(check('bitrefill.web3kit.space', { connectedApps })).toEqual({
          appName: 'Bitrefill',
          appDomain: 'bitrefill.com',
          reason: 'domain',
          isConnectedApp: true
        })
      })

      it('skips connected apps on shared hosting, localhost and IP addresses', () => {
        const apps = [
          { name: 'Myproject', url: 'https://myproject.vercel.app' },
          { name: 'Localapp', url: 'http://localapp.localhost:3000' },
          { name: 'Ipapp', url: 'http://127.0.0.1:8080' }
        ]
        expect(check('myproject.xyz', { name: 'Myproject', connectedApps: apps })).toBeNull()
        expect(check('other.vercel.app', { name: 'Myproject', connectedApps: apps })).toBeNull()
        expect(check('localapp.xyz', { name: 'Localapp', connectedApps: apps })).toBeNull()
      })

      it('prefers the hand-picked list over a connected app', () => {
        const apps = [{ name: 'Uniswap', url: 'https://app.uniswap.org' }]
        expect(check('uniswap.app', { connectedApps: apps })).toEqual({
          appName: 'Uniswap',
          appDomain: 'uniswap.org',
          reason: 'domain',
          isConnectedApp: false
        })
      })
    })

    it('has valid targets', () => {
      for (const target of IMPERSONATION_TARGETS) {
        expect(target.domains.length).toBeGreaterThan(0)
        expect(normalizeAppName(target.name)).not.toBe('')
      }
    })
  })
})
