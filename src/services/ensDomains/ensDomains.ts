import { isAddress, labelhash, namehash } from 'viem'
import { getEnsAddress, getEnsAvatar as viemGetEnsAvatar, normalize } from 'viem/ens'

import { RPCProvider } from '@/interfaces/provider'
import { fromDescriptor } from '@/libs/deployless/deployless'
import { getViemClientForProvider } from '@/services/provider'

import EnsGetter from '../../../contracts/compiled/EnsGetter.json'

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
const ENS_UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe'
export const NAMOSHI_UNIVERSAL_RESOLVER = '0xc5Ed1fA34AD1F23F0cD2E36DB288290488B1B493'
export const ENS_EXPIRY_WARN_WINDOW_IN_MS = 60 * 24 * 60 * 60 * 1000
const LOCAL_BATCH_GATEWAY_URL = 'x-batch-gateway:true'

const ETHEREUM_COIN_TYPE = 60n
const REVERSE_LOOKUP_CHUNK_SIZE = 50

// .eth BaseRegistrar (mainnet and sepolia share the same address).
export const ENS_BASE_REGISTRAR = '0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85'
// NameWrapper. Stores expiry for wrapped names, including subnames. For a wrapped `.eth` 2LD, its
// expiry already includes the grace-period offset, so no extra grace is added on that path.
export const ENS_NAME_WRAPPER = '0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401'
export const ENS_NAME_WRAPPER_SEPOLIA = '0x0635513f179D50A207757E05759CbD106d7dFcE8'

export type NameExpiry = {
  /** Registration expiry, in ms. Renewal is due at this point. */
  expiresAt: number
  /** End of the grace period, in ms. The name can be sniped only after this. */
  gracePeriodEndsAt: number
  updatedAt: number
}

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
 * Resolves an ENS/Namoshi domain to an address, avatar and (for ENS) its registration expiry.
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
    /** NameWrapper override forwarded to `getEnsExpiry` (mainnet default, sepolia on testnet). */
    nameWrapperAddress?: string
  }
}): Promise<{
  address: string
  avatar: string | null
  expiry: NameExpiry | null
}> {
  const normalizedDomainName = normalize(domain)
  if (!normalizedDomainName) return { address: '', avatar: null, expiry: null }

  const client = getViemClientForProvider(provider)
  const universalResolverAddress = !options?.isNamoshiDomain
    ? ENS_UNIVERSAL_RESOLVER
    : NAMOSHI_UNIVERSAL_RESOLVER

  const [address, avatar, expiry] = await Promise.all([
    getEnsAddress(client, { name: normalizedDomainName, universalResolverAddress }),
    viemGetEnsAvatar(client, { name: normalizedDomainName, universalResolverAddress }),
    // Namoshi domains live on a different chain without the ENS registrar/NameWrapper, so they have
    // no ENS expiry to read.
    options?.isNamoshiDomain
      ? Promise.resolve(null)
      : getEnsExpiry(provider, {
          name: normalizedDomainName,
          addresses: { nameWrapper: options?.nameWrapperAddress }
        })
  ])

  return {
    address: address || '',
    avatar,
    expiry
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

  return viemGetEnsAvatar(client, {
    name: normalizedName,
    universalResolverAddress: !options?.isNamoshiDomain
      ? ENS_UNIVERSAL_RESOLVER
      : NAMOSHI_UNIVERSAL_RESOLVER
  })
}

// Clamp to the max MS a JS Date
const MAX_SAFE_MS = 8_640_000_000_000_000

const toMs = (seconds: bigint): number => {
  const ms = seconds * 1000n
  return ms > BigInt(MAX_SAFE_MS) ? MAX_SAFE_MS : Number(ms)
}

const isDotEth2ld = (labels: string[]): boolean => labels.length === 2 && labels[1] === 'eth'

export type GetEnsExpiryParams = {
  /** The name, e.g. `name.eth`, `sub.name.eth`, `name.com`. */
  name: string
  /**
   * Force a specific source contract.
   * Omit to let the name shape decide (.eth 2LD -> registrar, else -> nameWrapper).
   */
  contract?: 'registrar' | 'nameWrapper'
  /** Override contract addresses (defaults are Ethereum mainnet). */
  addresses?: { baseRegistrar?: string; nameWrapper?: string }
}

/**
 * Returns the expiry of an ENS name.
 * Does two things depending on the name:
 *   - `.eth` 2LD (e.g. `name.eth`): read from the .eth BaseRegistrar, which gives the true
 *     registration expiry plus a separate GRACE_PERIOD. This holds whether or not the 2LD is wrapped.
 *   - everything else (subnames like `sub.name.eth`, wrapped DNS names like `name.com`): read from
 *     the NameWrapper via `getData`, which has no grace period, so `gracePeriodEndsAt === expiresAt`.
 */
async function getEnsExpiry(
  provider: RPCProvider,
  { name, contract, addresses }: GetEnsExpiryParams
): Promise<NameExpiry | null> {
  const normalized = normalize(name)
  const labels = normalized.split('.')
  const [firstLabel = ''] = labels

  const useRegistrar = contract === 'registrar' || (contract === undefined && isDotEth2ld(labels))

  const baseRegistrar = addresses?.baseRegistrar ?? ENS_BASE_REGISTRAR
  const nameWrapper = addresses?.nameWrapper ?? ENS_NAME_WRAPPER

  // labelhash(first label) is the registrar token id; namehash(full name) is the wrapper node.
  const id = useRegistrar ? BigInt(labelhash(firstLabel)) : BigInt(namehash(normalized))

  const deploylessEnsGetter = fromDescriptor(provider, EnsGetter, true)
  const { expiry, gracePeriod, blockTimestamp } = (await deploylessEnsGetter.call('getExpiry', [
    useRegistrar,
    baseRegistrar,
    nameWrapper,
    id
  ])) as { expiry: bigint; gracePeriod: bigint; blockTimestamp: bigint }

  if (expiry === 0n) return null

  return {
    expiresAt: toMs(expiry),
    gracePeriodEndsAt: toMs(expiry + gracePeriod),
    updatedAt: toMs(blockTimestamp)
  }
}

export { resolveENSDomain, getEnsAvatar, reverseLookupEns, getEnsExpiry }
