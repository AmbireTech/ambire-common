// @ts-nocheck
import constants from 'bip44-constants'
import { isAddress } from 'ethers'

import { normalize } from '@ensdomains/eth-ens-namehash'

import { RPCProvider } from '../../interfaces/settings'
import { getProvider } from '../provider'

const ETH_ID = 'ethereum'
const BIP44_BASE_VALUE = 2147483648
const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

const normalizeDomain = (domain) => {
  try {
    return normalize(domain)
  } catch (e) {
    return null
  }
}

function getNormalisedCoinType(bip44Item) {
  return bip44Item[0].length ? bip44Item[0][0] - BIP44_BASE_VALUE : null
}

async function resolveForCoin(resolver, bip44Item) {
  if (bip44Item && bip44Item.length === 1) {
    const coinType = getNormalisedCoinType(bip44Item)
    if (!coinType) return null
    return resolver.getAddress(coinType)
  }
  return resolver.getAddress()
}

export function isCorrectAddress(address) {
  return !(ADDRESS_ZERO === address) && isAddress(address)
}

// @TODO: Get RPC provider url from settings controller
async function resolveENSDomain(domain, bip44Item?: any): Promise<string> {
  const normalizedDomainName = normalizeDomain(domain)
  if (!normalizedDomainName) return ''
  const provider = getProvider(ETH_ID)
  const resolver = await provider.getResolver(normalizedDomainName)
  if (!resolver) return ''
  try {
    const ethAddress = await resolver.getAddress()
    const addressForCoin = await resolveForCoin(resolver, bip44Item).catch(() => null)
    return isCorrectAddress(addressForCoin) ? addressForCoin : ethAddress
  } catch (e) {
    // If the error comes from an internal server error don't
    // show it to the user, because it happens when a domain
    // doesn't exist and we already show a message for that.
    // https://dnssec-oracle.ens.domains/ 500 (ISE)
    if (e.message?.includes('500_SERVER_ERROR')) return ''

    throw e
  }
}

function getBip44Items(coinTicker) {
  if (!coinTicker) return null
  return constants.filter((item) => item[1] === coinTicker)
}

async function queryGraph(endpoint: string, query: string, fetch: Function): Promise<any> {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ query })
  })

  return resp.json()
}

async function getAllEnsDomains(address: string, fetch: Function): Promise<Array<string>> {
  const endpoint = 'https://api.thegraph.com/subgraphs/name/ensdomains/ens'
  const query = `{
    domains(where:{owner:"${address.toLowerCase()}"}) {
      name
    }
  }`

  const res = await queryGraph(endpoint, query, fetch)

  return res.data.domains.map((d: any) => d.name)
}

async function getPrimaryEnsDomain(ethereumProvider: RPCProvider, address: string) {
  return ethereumProvider.lookupAddress(address)
}

async function reverseLookupEns(address: string, provider: RPCProvider, fetch: Function) {
  const primaryEnsDomain = await getPrimaryEnsDomain(provider, address)

  if (primaryEnsDomain) return primaryEnsDomain

  return (await getAllEnsDomains(address, fetch))[0] || null
}

export { resolveENSDomain, getBip44Items, reverseLookupEns }
