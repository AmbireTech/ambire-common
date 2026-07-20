import { ENS_EXPIRY_WARN_WINDOW_IN_MS, NameExpiry } from '@/services/ensDomains/ensDomains'
import { expect } from '@jest/globals'

import { EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS, isNameExpiryStale } from './expiry'
import {
  getNameService,
  getPrimaryName,
  getSearchableNames,
  matchNameResolver,
  NAME_SERVICE_IDS,
  NAME_SERVICE_LABELS
} from './helpers'
import { DEFAULT_RESOLVERS } from './resolvers'
import { ENS_SUBNAME_EXPIRY_TTL_IN_MS } from './resolvers/EnsResolver'

const WARN_WINDOW = ENS_EXPIRY_WARN_WINDOW_IN_MS
const ensResolver = DEFAULT_RESOLVERS.find((r) => r.id === 'ens')!
const namoshiResolver = DEFAULT_RESOLVERS.find((r) => r.id === 'namoshi')!
const gnsResolver = DEFAULT_RESOLVERS.find((r) => r.id === 'gns')!

describe('matchNameResolver / getNameService', () => {
  it('routes a specific TLD to its service and everything else to the ENS fallback', () => {
    expect(getNameService('vitalik.eth')?.id).toBe('ens')
    expect(getNameService('example.com')?.id).toBe('ens') // ENS resolves DNS names too
    expect(getNameService('nemo.citrea')?.id).toBe('namoshi')
    expect(getNameService('satoshi.btc')?.id).toBe('namoshi')
    expect(getNameService('donnoh.gwei')?.id).toBe('gns')
  })

  it('falls back to ENS even when no resolver is passed as specific', () => {
    // Only the fallback available -> it still owns the domain.
    expect(matchNameResolver([ensResolver], 'nemo.citrea')?.id).toBe('ens')
    // Fallback removed and no specific match -> nothing owns it.
    expect(matchNameResolver([namoshiResolver, gnsResolver], 'vitalik.eth')).toBeUndefined()
  })
})

describe('getPrimaryName', () => {
  it('returns the highest-priority resolved name (ENS wins over the others)', () => {
    expect(getPrimaryName({ ens: 'a.eth', namoshi: 'b.btc', gns: 'c.gwei' })).toEqual({
      id: 'ens',
      name: 'a.eth'
    })
    expect(getPrimaryName({ ens: null, namoshi: 'b.btc' })).toEqual({
      id: 'namoshi',
      name: 'b.btc'
    })
    expect(getPrimaryName({ ens: null, namoshi: null, gns: 'c.gwei' })).toEqual({
      id: 'gns',
      name: 'c.gwei'
    })
  })

  it('returns null when there is no resolved name', () => {
    expect(getPrimaryName(undefined)).toBe(null)
    expect(getPrimaryName({})).toBe(null)
    expect(getPrimaryName({ ens: null, namoshi: null, gns: null })).toBe(null)
  })
})

describe('name service metadata (derived from resolvers)', () => {
  it('exposes an id and a human-readable label for every resolver', () => {
    ;[ensResolver, namoshiResolver, gnsResolver].forEach((resolver) => {
      expect(resolver.label).toBeTruthy()
    })
    expect(ensResolver.label).toBe('ENS')
    expect(namoshiResolver.label).toBe('Namoshi')
    expect(gnsResolver.label).toBe('GNS')
  })

  it('lists every service id in resolver (display-priority) order', () => {
    expect(NAME_SERVICE_IDS).toEqual(DEFAULT_RESOLVERS.map((r) => r.id))
  })

  it('maps each id to its resolver label', () => {
    expect(NAME_SERVICE_LABELS).toEqual({ ens: 'ENS', namoshi: 'Namoshi', gns: 'GNS' })
    // Kept in sync with the id list, so a new service is covered without extra edits.
    expect(Object.keys(NAME_SERVICE_LABELS).sort()).toEqual([...NAME_SERVICE_IDS].sort())
  })
})

describe('getSearchableNames', () => {
  it('joins every resolved name, lowercased and trimmed, in priority order', () => {
    expect(
      getSearchableNames({ ens: 'Vitalik.eth', namoshi: ' Satoshi.BTC ', gns: 'Donnoh.gwei' })
    ).toBe('vitalik.eth satoshi.btc donnoh.gwei')
  })

  it('skips missing/null names', () => {
    expect(getSearchableNames({ ens: 'a.eth', namoshi: null })).toBe('a.eth')
    expect(getSearchableNames({ gns: 'c.gwei' })).toBe('c.gwei')
  })

  it('returns an empty string when there is nothing to search', () => {
    expect(getSearchableNames(undefined)).toBe('')
    expect(getSearchableNames({})).toBe('')
    expect(getSearchableNames({ ens: null, namoshi: null, gns: null })).toBe('')
  })
})

describe('resolver capabilities', () => {
  it('marks only ENS as expirable (ENS-compatible services share the ENS path but have no registrar)', () => {
    expect(ensResolver.capabilities.expiry).toBe(true)
    expect(namoshiResolver.capabilities.expiry).toBe(false)
    expect(gnsResolver.capabilities.expiry).toBe(false)

    // All ENS-family services support forward/reverse/avatar.
    ;[ensResolver, namoshiResolver, gnsResolver].forEach((resolver) => {
      expect(resolver.capabilities.reverse).toBe(true)
      expect(resolver.capabilities.avatar).toBe(true)
    })
  })

  it('marks ENS as the single fallback service', () => {
    expect(DEFAULT_RESOLVERS.filter((r) => r.isFallback).map((r) => r.id)).toEqual(['ens'])
  })
})

describe('isNameExpiryStale (generic staleness policy)', () => {
  it('refetches when never fetched (undefined / null)', () => {
    expect(isNameExpiryStale(undefined)).toBe(true)
    expect(isNameExpiryStale(null)).toBe(true)
  })

  it('does NOT refetch when far from the deadline, even if the cache is old', () => {
    const farExpiry: NameExpiry = {
      expiresAt: Date.now() + WARN_WINDOW * 2,
      gracePeriodEndsAt: Date.now() + WARN_WINDOW * 2,
      updatedAt: Date.now() - EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS * 2
    }
    expect(isNameExpiryStale(farExpiry)).toBe(false)
  })

  it('does NOT refetch when close to the deadline but freshly fetched', () => {
    const closeFresh: NameExpiry = {
      expiresAt: Date.now(),
      gracePeriodEndsAt: Date.now() + WARN_WINDOW - 60_000,
      updatedAt: Date.now()
    }
    expect(isNameExpiryStale(closeFresh)).toBe(false)
  })

  it('refetches when close to the deadline and the cache is stale', () => {
    const closeStale: NameExpiry = {
      expiresAt: Date.now(),
      gracePeriodEndsAt: Date.now() + WARN_WINDOW - 60_000,
      updatedAt: Date.now() - EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS - 60_000
    }
    expect(isNameExpiryStale(closeStale)).toBe(true)
  })
})

describe('EnsResolver shouldRefetchExpiry', () => {
  const shouldRefetch = (name: string, expiry: NameExpiry | null | undefined) =>
    ensResolver.shouldRefetchExpiry!(name, expiry)

  it('refetches when never fetched (undefined / null)', () => {
    expect(shouldRefetch('vitalik.eth', undefined)).toBe(true)
    expect(shouldRefetch('vitalik.eth', null)).toBe(true)
  })

  it('follows the generic policy for a 2LD (far -> keep, close+stale -> refetch)', () => {
    const far: NameExpiry = {
      expiresAt: Date.now() + WARN_WINDOW * 2,
      gracePeriodEndsAt: Date.now() + WARN_WINDOW * 2,
      updatedAt: Date.now() - EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS * 2
    }
    expect(shouldRefetch('vitalik.eth', far)).toBe(false)

    const closeStale: NameExpiry = {
      expiresAt: Date.now(),
      gracePeriodEndsAt: Date.now() + WARN_WINDOW - 60_000,
      updatedAt: Date.now() - EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS - 60_000
    }
    expect(shouldRefetch('vitalik.eth', closeStale)).toBe(true)
  })

  describe('subnames', () => {
    // A subname's expiry (set via NameWrapper `setChildFuses`) can be shortened at any time by the
    // parent name's owner, unlike a .eth 2LD's registrar expiry which can only increase.
    const SUBNAME = 'someone.ambire.eth'

    it('refetches once the subname TTL elapses, even far from the deadline', () => {
      const staleFar: NameExpiry = {
        expiresAt: Date.now() + WARN_WINDOW * 2,
        gracePeriodEndsAt: Date.now() + WARN_WINDOW * 2,
        updatedAt: Date.now() - ENS_SUBNAME_EXPIRY_TTL_IN_MS - 60_000
      }
      expect(shouldRefetch(SUBNAME, staleFar)).toBe(true)
    })

    it('does NOT refetch before the subname TTL elapses, when far from the deadline', () => {
      const freshFar: NameExpiry = {
        expiresAt: Date.now() + WARN_WINDOW * 2,
        gracePeriodEndsAt: Date.now() + WARN_WINDOW * 2,
        updatedAt: Date.now() - ENS_SUBNAME_EXPIRY_TTL_IN_MS + 60_000
      }
      expect(shouldRefetch(SUBNAME, freshFar)).toBe(false)
    })

    it('still refetches close to the deadline via the generic check, even within the subname TTL', () => {
      const closeStaleWithinSubnameTtl: NameExpiry = {
        expiresAt: Date.now(),
        gracePeriodEndsAt: Date.now() + WARN_WINDOW - 60_000,
        updatedAt: Date.now() - EXPIRY_CLOSE_TO_DEADLINE_POLL_IN_MS - 60_000
      }
      expect(shouldRefetch(SUBNAME, closeStaleWithinSubnameTtl)).toBe(true)
    })

    it('does NOT refetch when within both the subname TTL and the close-to-deadline window', () => {
      const closeFreshWithinSubnameTtl: NameExpiry = {
        expiresAt: Date.now(),
        gracePeriodEndsAt: Date.now() + WARN_WINDOW - 60_000,
        updatedAt: Date.now()
      }
      expect(shouldRefetch(SUBNAME, closeFreshWithinSubnameTtl)).toBe(false)
    })
  })
})
