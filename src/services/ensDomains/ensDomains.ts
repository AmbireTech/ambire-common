import { isAddress } from 'viem'
import { normalize } from 'viem/ens'

import { RPCProvider } from '@/interfaces/provider'
import { getViemClientForProvider } from '@/services/provider'

const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
const ENS_UNIVERSAL_RESOLVER = '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe'
export const NAMOSHI_UNIVERSAL_RESOLVER = '0xc5Ed1fA34AD1F23F0cD2E36DB288290488B1B493'

export function getIsNamoshiDomain(domain: string) {
  return domain.endsWith('.btc') || domain.endsWith('.citrea')
}

export function isCorrectAddress(address: string) {
  return !(ADDRESS_ZERO === address) && isAddress(address)
}

async function resolveENSDomain({
  provider,
  domain,
  options
}: {
  provider: RPCProvider
  domain: string
  options?: {
    universalResolverAddress?: string
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
      universalResolverAddress: options?.universalResolverAddress || ENS_UNIVERSAL_RESOLVER
    }),
    client.getEnsAvatar({
      name: normalizedDomainName,
      universalResolverAddress: options?.universalResolverAddress || ENS_UNIVERSAL_RESOLVER
    })
  ])

  return {
    address: address || '',
    avatar
  }
}

async function reverseLookupEns(
  address: string,
  provider: RPCProvider,
  options?: {
    universalResolverAddress?: string
  }
) {
  const client = getViemClientForProvider(provider)

  return client.getEnsName({
    address: address as `0x${string}`,
    universalResolverAddress: options?.universalResolverAddress || ENS_UNIVERSAL_RESOLVER
  })
}

async function getEnsAvatar(
  name: string,
  provider: RPCProvider,
  options?: {
    universalResolverAddress?: string
  }
) {
  const normalizedName = normalize(name)
  if (!normalizedName) return null

  const client = getViemClientForProvider(provider)

  return client.getEnsAvatar({
    name: normalizedName,
    universalResolverAddress: options?.universalResolverAddress || ENS_UNIVERSAL_RESOLVER
  })
}

export { resolveENSDomain, getEnsAvatar, reverseLookupEns }
