import { getAddress } from 'ethers'

import { expect } from '@jest/globals'

import { Domains } from '../interfaces/domains'
import {
  getAddressFromAddressState,
  getDomainFromAddressState,
  getResolvedDomainName
} from './domains'

const ADDRESS = getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

describe('utils/domains', () => {
  describe('getAddressFromAddressState', () => {
    it('prefers the resolved address over the raw field value', () => {
      expect(
        getAddressFromAddressState({ resolvedAddress: ADDRESS, fieldValue: 'vitalik.eth' })
      ).toBe(ADDRESS)
    })

    it('falls back to the trimmed field value when nothing resolved', () => {
      expect(getAddressFromAddressState({ resolvedAddress: '', fieldValue: '  0xabc  ' })).toBe(
        '0xabc'
      )
    })
  })

  describe('getDomainFromAddressState', () => {
    it('returns the field value when a domain resolved', () => {
      expect(
        getDomainFromAddressState({ resolvedAddressType: 'ens', fieldValue: 'vitalik.eth' })
      ).toBe('vitalik.eth')
    })

    it('returns undefined when nothing resolved (no resolvedAddressType)', () => {
      expect(
        getDomainFromAddressState({ resolvedAddressType: null, fieldValue: 'invalid.ethc' })
      ).toBeUndefined()
    })
  })

  describe('getResolvedDomainName', () => {
    const domains: Domains = {
      [ADDRESS]: { names: { ens: 'vitalik.eth', namoshi: null }, createdAt: 1, updatedAt: 1 }
    }

    it('reads the resolver-normalized name stored for the resolved address and service', () => {
      expect(
        getResolvedDomainName(domains, { resolvedAddress: ADDRESS, resolvedAddressType: 'ens' })
      ).toBe('vitalik.eth')
    })

    it('checksums the address before lookup, so a lowercased resolvedAddress still matches', () => {
      expect(
        getResolvedDomainName(domains, {
          resolvedAddress: ADDRESS.toLowerCase(),
          resolvedAddressType: 'ens'
        })
      ).toBe('vitalik.eth')
    })

    it('returns undefined when nothing resolved', () => {
      expect(
        getResolvedDomainName(domains, { resolvedAddress: '', resolvedAddressType: null })
      ).toBeUndefined()
    })

    it('returns undefined when the address has no name for that service', () => {
      expect(
        getResolvedDomainName(domains, { resolvedAddress: ADDRESS, resolvedAddressType: 'namoshi' })
      ).toBeUndefined()
    })
  })
})
