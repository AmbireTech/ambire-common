// @ts-ignore
import constants from 'bip44-constants'
import {
  BigNumberish,
  Contract,
  dnsEncode,
  EnsResolver,
  getBigInt,
  Interface,
  isAddress,
  isError,
  isHexString,
  namehash
} from 'ethers'

// @ts-ignore
import { normalize } from '@ensdomains/eth-ens-namehash'

import { networks } from '../../consts/networks'
import { RPCProvider } from '../../interfaces/provider'
import { getRpcProvider } from '../provider'

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

// @TODO: Get RPC provider url from settings controller
async function resolveENSDomain(
  domain: string,
  bip44Item?: number[][]
): Promise<{
  address: string
  avatar: string | null
}> {
  const normalizedDomainName = normalizeDomain(domain)
  if (!normalizedDomainName)
    return {
      address: '',
      avatar: null
    }
  const ethereum = networks.find((n) => n.chainId === 1n)!
  const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)
  const resolver = await provider.getResolver(normalizedDomainName)

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
  } finally {
    provider?.destroy()
  }
}

function getBip44Items(coinTicker: string) {
  if (!coinTicker) return null
  return constants.filter((item: string[]) => item[1] === coinTicker)
}

/**
 * Returns the reverse name for an address and coin type
 * Following ENSIP-19: https://docs.ens.domains/ensip/19
 */
function getReverseName(address: string, paramCoinType: BigNumberish = 60) {
  let coinType = paramCoinType

  if (!(address.length > 2 && isHexString(address)))
    throw new Error('address must be non-empty hex string')

  coinType = getBigInt(coinType, 'coinType')
  return `${address.toLowerCase().slice(2)}.${
    // eslint-disable-next-line no-nested-ternary
    coinType === 60n ? 'addr' : coinType === 0x80000000n ? 'default' : coinType.toString(16)
  }.reverse`
}

/**
 * Get the name from a reverse resolver, handling wildcard resolvers (ENSIP-10)
 * This replicates the logic from the ethers.js PR #4632
 */
async function getNameFromResolver(
  resolver: EnsResolver,
  reverseName: string
): Promise<null | string> {
  try {
    const resolverContract = new Contract(
      resolver.address,
      [
        'function supportsInterface(bytes4) view returns (bool)',
        'function resolve(bytes, bytes) view returns (bytes)',
        'function name(bytes32) view returns (string)'
      ],
      resolver.provider
    )

    const node = namehash(reverseName)

    // Check if this is a wildcard resolver (EIP-2544)
    let isWildcard = false
    try {
      isWildcard = await resolverContract.supportsInterface!('0x9061b923')
    } catch {
      // If supportsInterface fails, assume it's not a wildcard resolver
      isWildcard = false
    }

    let name: string
    if (isWildcard) {
      // For wildcard resolvers, use resolve(bytes,bytes)
      const iface = new Interface(['function name(bytes32) view returns (string)'])
      const calldata = iface.encodeFunctionData('name', [node])

      const result = await resolverContract.resolve!(dnsEncode(reverseName), calldata, {
        enableCcipRead: true
      })

      name = iface.decodeFunctionResult('name', result)[0]
    } else {
      // For regular resolvers, call name(bytes32) directly
      name = await resolverContract.name!(node, {
        enableCcipRead: true
      })
    }

    if (name == null || name === '0x' || name === '') {
      return null
    }
    return name
  } catch (error) {
    // If the resolver doesn't support name(), return null
    if (isError(error, 'CALL_EXCEPTION')) {
      return null
    }
    // No data returned
    if (isError(error, 'BAD_DATA') && (error as any).value === '0x') {
      return null
    }

    throw error
  }
}

async function reverseLookupEns(address: string, provider: RPCProvider) {
  const reverseName = getReverseName(address)

  try {
    const revResolver = await provider.getResolver(reverseName)

    if (!revResolver) {
      return null
    }

    const name = await getNameFromResolver(revResolver, reverseName)

    if (name) {
      // Perform roundtrip check: name -> address should match original address
      // As per https://docs.ens.domains/resolution#reverse-resolution
      const resolver = await provider.getResolver(name)
      if (resolver) {
        const expect = await resolver.getAddress(60)

        if (expect) {
          if (expect.toLowerCase() !== address.toLowerCase()) {
            return null
          }
          return name
        }
      }
    }

    return null
  } catch (error) {
    // No data was returned from the resolver
    if (isError(error, 'BAD_DATA') && error.value === '0x') {
      return null
    }
    // Something reverted
    if (isError(error, 'CALL_EXCEPTION')) {
      return null
    }
    throw error
  }
}

async function getEnsAvatar(name: string, provider: RPCProvider) {
  return provider.getAvatar(name)
}

export { resolveENSDomain, getBip44Items, getEnsAvatar, reverseLookupEns }
