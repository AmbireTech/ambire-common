import dotenv from 'dotenv'
import { ethers } from 'ethers'

import { ErrorRef } from 'controllers/eventEmitter/eventEmitter'
import { geckoIdMapper, geckoNetworkIdMapper } from '../../consts/coingecko'
import { networks } from '../../consts/networks'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import {
  AbiFragment,
  HumanizerFragment,
  HumanizerMeta,
  HumanizerSettings,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall
} from './interfaces'

dotenv.config()
const COINGECKO_PRO_API_KEY = process.env.COINGECKO_PRO_API_KEY

export function getWarning(
  content: string,
  level: HumanizerWarning['level'] = 'caution'
): HumanizerWarning {
  return { content, level }
}

export function getLabel(content: string): HumanizerVisualization {
  return { type: 'label', content }
}
export function getAction(content: string): HumanizerVisualization {
  return { type: 'action', content }
}
export function getAddressVisualization(_address: string, name?: string): HumanizerVisualization {
  const address = _address.toLowerCase()
  return name ? { type: 'address', address, name } : { type: 'address', address }
}

export function getToken(_address: string, amount: bigint, name?: string): HumanizerVisualization {
  const address = _address.toLowerCase()
  return name ? { type: 'token', address, amount, name } : { type: 'token', address, amount }
}

export function getNft(address: string, id: bigint): HumanizerVisualization {
  return { type: 'nft', address, id }
}

export function getOnBehalfOf(
  onBehalfOf: string,
  sender: string,
  name?: string
): HumanizerVisualization[] {
  return onBehalfOf.toLowerCase() !== sender.toLowerCase()
    ? [getLabel('on befalf of'), getAddressVisualization(onBehalfOf, name)]
    : []
}

// @TODO on some humanization of uniswap there is recipient 0x000...000
export function getRecipientText(from: string, recipient: string): HumanizerVisualization[] {
  return from.toLowerCase() === recipient.toLowerCase()
    ? []
    : [getLabel('and send it to'), getAddressVisualization(recipient)]
}

export function getDeadlineText(deadline: bigint): string {
  const minute = 60000n
  const diff = deadline - BigInt(Date.now())

  if (diff < 0 && diff > -minute * 2n) return 'expired just now'
  if (diff < 0) return 'already expired'
  if (diff < minute) return 'expires in less than a minute'
  if (diff < 10n * minute) return `expires in ${Math.floor(Number(diff / minute))} minutes`
  return `valid until ${new Date(Number(deadline)).toLocaleString()}`
}

export function getDeadline(deadlineSecs: bigint): HumanizerVisualization {
  const deadline = deadlineSecs * 1000n
  return {
    type: 'deadline',
    amount: deadline
  }
}

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 5)}...${addr.slice(-3)}`
}

/**
 * Make a request to coingecko to fetch the latest price of the native token.
 * This is used by benzina and hence we cannot wrap the errors in emitError
 */
// @TODO this shouldn't be here, a more suitable place would be portfolio/gecko
export async function getNativePrice(network: NetworkDescriptor, fetch: Function): Promise<number> {
  const platformId = geckoIdMapper(ethers.ZeroAddress, network.id)
  if (!platformId) {
    throw new Error(`getNativePrice: ${network.name} is not supported`)
  }

  const baseUrl = COINGECKO_PRO_API_KEY
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3'
  const postfix = COINGECKO_PRO_API_KEY ? `&x_cg_pro_api_key=${COINGECKO_PRO_API_KEY}` : ''
  const coingeckoQueryUrl = `${baseUrl}/simple/price?ids=${platformId}&vs_currencies=usd${postfix}`
  let response = await fetch(coingeckoQueryUrl)
  response = await response.json()

  if (!response[platformId] || !response[platformId].usd) {
    throw new Error(`getNativePrice: could not fetch native token price for ${network.name} `)
  }

  return response[platformId].usd
}

// @TODO maybe this shouldn't be here, more suitable place would be humanizer/modules/tokens
export async function getTokenInfo(
  humanizerSettings: HumanizerSettings,
  address: string,
  options: any
): Promise<HumanizerFragment | null> {
  const network = networks.find((n: NetworkDescriptor) => n.id === humanizerSettings.networkId)
  const platformId = geckoNetworkIdMapper(network!.id)
  try {
    const baseUrl = COINGECKO_PRO_API_KEY
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3'
    const postfix = COINGECKO_PRO_API_KEY ? `?&x_cg_pro_api_key=${COINGECKO_PRO_API_KEY}` : ''
    const coingeckoQueryUrl = `${baseUrl}/coins/${
      platformId || network?.chainId
    }/contract/${address}${postfix}`
    let response = await options.fetch(coingeckoQueryUrl)
    response = await response.json()
    if (response.symbol && response.detail_platforms?.ethereum?.decimal_place)
      return {
        type: 'token',
        key: address.toLowerCase(),
        value: {
          symbol: response.symbol.toUpperCase(),
          decimals: response.detail_platforms?.ethereum?.decimal_place
        },
        isGlobal: true
      }

    // @TODO: rething error levels
    if (response.symbol && response.detail_platforms) {
      options.emitError({
        message: `getTokenInfo: token not supported on network ${network?.name} `,
        error: new Error(`token not supported on network ${network?.name}`),
        level: 'silent'
      })
      return null
    }
    options.emitError({
      message: 'getTokenInfo: something is wrong goingecko reponse format or 404',
      error: new Error('unexpected response format or 404'),
      level: 'silent'
    })
    return null
  } catch (e: any) {
    options.emitError({
      message: `getTokenInfo: something is wrong with coingecko api ${e.message}`,
      error: e,
      level: 'silent'
    })
    return null
  }
}

export function checkIfUnknownAction(v: Array<HumanizerVisualization>): boolean {
  try {
    return !!(v[0].type === 'action' && v?.[0]?.content?.startsWith('Unknown action'))
  } catch (e) {
    return false
  }
}

export function getUnknownVisualization(name: string, call: IrCall): HumanizerVisualization[] {
  const unknownVisualization = [
    getAction(`Unknown action (${name})`),
    getLabel('to'),
    getAddressVisualization(call.to)
  ]
  if (call.value)
    unknownVisualization.push(
      ...[getLabel('and'), getAction('Send'), getToken(ethers.ZeroAddress, call.value)]
    )
  return unknownVisualization
}

export function getWraping(address: string, amount: bigint): HumanizerVisualization[] {
  return [getAction('Wrap'), getToken(address, amount)]
}

export function getUnwraping(address: string, amount: bigint): HumanizerVisualization[] {
  return [getAction('Unwrap'), getToken(address, amount)]
}

export function getKnownAbi(
  humanizerMeta: HumanizerMeta | undefined,
  abiName: string,
  options?: any // @TODO make HumanizerOptions interface
): string[] {
  if (!humanizerMeta) {
    options.emitError({})
    options.emitError({
      message: 'getKnownAbi: tried to use the humanizer without humanizerMeta',
      level: 'major',
      error: new Error('getKnownAbi: tried to use the humanizer without humanizerMeta')
    } as ErrorRef)
    return []
  }
  return Object.values(humanizerMeta.abis[abiName]).map((i: AbiFragment): string => i.signature)
}

export function getKnownName(
  humanizerMeta: HumanizerMeta | undefined,
  address: string
): string | undefined {
  return humanizerMeta?.knownAddresses?.[address.toLowerCase()]?.name
}

export function getKnownToken(
  humanizerMeta: HumanizerMeta | undefined,
  address: string
): { decimals: number; symbol: string } | undefined {
  return humanizerMeta?.knownAddresses?.[address.toLowerCase()]?.token
}
