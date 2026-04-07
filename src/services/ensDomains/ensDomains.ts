import '@ensdomains/ethers-patch-v6'

// @ts-ignore
import constants from 'bip44-constants'
import { EnsResolver, isAddress } from 'ethers'

// @ts-ignore
import { normalize } from '@ensdomains/eth-ens-namehash'

import { RPCProvider } from '../../interfaces/provider'

const BIP44_BASE_VALUE = 2147483648
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

const normalizeDomain = (domain: string) => {
  try {
    return normalize(domain)
  } catch (e) {
    return null
  }
}

function getNormalisedCoinType(bip44Item: number[][]) {
  const firstItem = bip44Item[0]

  if (!firstItem) return null
  return firstItem.length && firstItem[0] ? firstItem[0] - BIP44_BASE_VALUE : null
}

async function resolveForCoin(resolver: any, bip44Item?: number[][]) {
  if (bip44Item && bip44Item.length === 1) {
    const coinType = getNormalisedCoinType(bip44Item)
    if (!coinType) return null
    return resolver.getAddress(coinType)
  }
  return resolver.getAddress()
}

export function isCorrectAddress(address: string) {
  return !(ADDRESS_ZERO === address) && isAddress(address)
}

async function resolveENSDomain({
  provider,
  domain,
  bip44Item
}: {
  provider: RPCProvider
  domain: string
  bip44Item?: number[][]
}): Promise<{
  address: string
  avatar: string | null
}> {
  const normalizedDomainName = normalizeDomain(domain)
  if (!normalizedDomainName) return { address: '', avatar: null }
  const resolver = await EnsResolver.fromName(provider, normalizedDomainName).catch(() => null)

  if (!resolver)
    return {
      address: '',
      avatar: null
    }

  try {
    const [ethAddress, avatar] = await Promise.all([
      resolver.getAddress().catch(() => null),
      resolver.getAvatar().catch(() => null)
    ])
    const addressForCoin = await resolveForCoin(resolver, bip44Item).catch(() => null)

    return {
      address: isCorrectAddress(addressForCoin) ? addressForCoin : ethAddress || '',
      avatar
    }
  } catch (e: any) {
    // If the error comes from an internal server error don't
    // show it to the user, because it happens when a domain
    // doesn't exist and we already show a message for that.
    // https://dnssec-oracle.ens.domains/ 500 (ISE)
    if (e.message?.includes('500_SERVER_ERROR'))
      return {
        address: '',
        avatar: null
      }

    throw e
  }
}

function getBip44Items(coinTicker: string) {
  if (!coinTicker) return null
  return constants.filter((item: string[]) => item[1] === coinTicker)
}

async function reverseLookupEns(address: string, provider: RPCProvider) {
  return provider.lookupAddress(address)
}

async function getEnsAvatar(name: string, provider: RPCProvider) {
  return provider.getAvatar(name)
}

export { resolveENSDomain, getBip44Items, getEnsAvatar, reverseLookupEns }
