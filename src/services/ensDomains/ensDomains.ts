import { isAddress } from 'viem'
import { normalize } from 'viem/ens'

import { RPCProvider } from '@/interfaces/provider'
import { fromDescriptor } from '@/libs/deployless/deployless'
import { getViemClientForProvider } from '@/services/provider'

import EnsGetter from '../../../contracts/compiled/EnsGetter.json'

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
const ENS_UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe'
export const NAMOSHI_UNIVERSAL_RESOLVER = '0xc5Ed1fA34AD1F23F0cD2E36DB288290488B1B493'
const LOCAL_BATCH_GATEWAY_URL = 'x-batch-gateway:true'

const ETHEREUM_COIN_TYPE = 60n
const REVERSE_LOOKUP_CHUNK_SIZE = 50

export type ReverseLookupResult = {
  [address: string]: {
    name: string | null
    failed: boolean
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export function getIsNamoshiDomain(domain: string) {
  return domain.endsWith('.btc') || domain.endsWith('.citrea')
}

export function isCorrectAddress(address: string) {
  return !(ADDRESS_ZERO === address) && isAddress(address)
}

/**
 * Resolves an ENS/Namoshi domain to an address and avatar.
 *
 * Can work with a custom universal resolver if the domain is a Namoshi domain, otherwise it defaults to the ENS universal resolver.
 */
async function resolveENSDomain({
  provider,
  domain,
  options
}: {
  provider: RPCProvider
  domain: string
  options?: {
    isNamoshiDomain?: boolean
  }
}): Promise<{
  address: string
  avatar: string | null
}> {
  const normalizedDomainName = normalize(domain)
  if (!normalizedDomainName) return { address: '', avatar: null }

  const client = getViemClientForProvider(provider)

  const [address, avatar] = await Promise.all([
    client.getEnsAddress({
      name: normalizedDomainName,
      universalResolverAddress: !options?.isNamoshiDomain
        ? ENS_UNIVERSAL_RESOLVER
        : NAMOSHI_UNIVERSAL_RESOLVER
    }),
    client.getEnsAvatar({
      name: normalizedDomainName,
      universalResolverAddress: !options?.isNamoshiDomain
        ? ENS_UNIVERSAL_RESOLVER
        : NAMOSHI_UNIVERSAL_RESOLVER
    })
  ])

  return {
    address: address || '',
    avatar
  }
}

/**
 * Batches the reverse lookup (address -> primary name) for many addresses into deployless.
 *
 * CCIP-read (EIP-3668) reverse records cannot be resolved inside a single `eth_call` (there is
 * no client-side gateway handling), so the contract flags them as `needsOffchainLookup` and we
 * fallback to viem's `getEnsName` for just those addresses.
 */
async function reverseLookupEns(
  addresses: string[],
  provider: RPCProvider,
  options?: {
    isNamoshiDomain?: boolean
  }
): Promise<ReverseLookupResult> {
  if (!addresses.length) return {}

  const universalResolverAddress = !options?.isNamoshiDomain
    ? ENS_UNIVERSAL_RESOLVER
    : NAMOSHI_UNIVERSAL_RESOLVER

  const result: ReverseLookupResult = {}
  const offchainLookupAddresses: string[] = []

  const deploylessEnsGetter = fromDescriptor(provider, EnsGetter, true)

  const addressChunks = chunkArray(addresses, REVERSE_LOOKUP_CHUNK_SIZE)
  const chunkResults = await Promise.allSettled(
    addressChunks.map((addressChunk) =>
      deploylessEnsGetter.call('getNames', [
        universalResolverAddress,
        addressChunk,
        ETHEREUM_COIN_TYPE,
        [LOCAL_BATCH_GATEWAY_URL]
      ])
    )
  )

  addressChunks.forEach((addressChunk, chunkIndex) => {
    const chunkResult = chunkResults[chunkIndex]

    if (!chunkResult || chunkResult.status === 'rejected') {
      if (chunkResult?.status === 'rejected') {
        console.warn('batched reverse lookup chunk failed', chunkResult.reason)
      }
      addressChunk.forEach((address) => {
        result[address] = { name: null, failed: true }
      })
      return
    }

    addressChunk.forEach((address, index) => {
      if (!chunkResult.value) return

      const reverseResult = chunkResult.value[index] as
        | { resolvedName: string; hasName: boolean; needsOffchainLookup: boolean }
        | undefined

      if (reverseResult?.needsOffchainLookup) {
        offchainLookupAddresses.push(address)
        return
      }

      result[address] = {
        name: reverseResult?.hasName ? reverseResult.resolvedName || null : null,
        failed: false
      }
    })
  })

  if (offchainLookupAddresses.length) {
    const client = getViemClientForProvider(provider)

    await Promise.all(
      offchainLookupAddresses.map(async (address) => {
        try {
          const name = await client.getEnsName({
            address: address as `0x${string}`,
            universalResolverAddress,
            coinType: ETHEREUM_COIN_TYPE
          })
          result[address] = { name: name || null, failed: false }
        } catch (e) {
          console.warn('CCIP-read reverse lookup failed for address', address, e)
          result[address] = { name: null, failed: true }
        }
      })
    )
  }

  return result
}

async function getEnsAvatar(
  name: string,
  provider: RPCProvider,
  options?: {
    isNamoshiDomain?: boolean
  }
) {
  const normalizedName = normalize(name)
  if (!normalizedName) return null

  const client = getViemClientForProvider(provider)

  return client.getEnsAvatar({
    name: normalizedName,
    universalResolverAddress: !options?.isNamoshiDomain
      ? ENS_UNIVERSAL_RESOLVER
      : NAMOSHI_UNIVERSAL_RESOLVER
  })
}

export { resolveENSDomain, getEnsAvatar, reverseLookupEns }
