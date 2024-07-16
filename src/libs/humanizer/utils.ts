import dotenv from 'dotenv'
import { ZeroAddress } from 'ethers'

import { geckoIdMapper } from '../../consts/coingecko'
import { Fetch } from '../../interfaces/fetch'
import { HumanizerFragment } from '../../interfaces/humanizer'
import { Network } from '../../interfaces/network'
import {
  HumanizerMeta,
  HumanizerSettings,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall
} from './interfaces'

dotenv.config()

const baseUrlCena = 'https://cena.ambire.com/api/v3'

export const HUMANIZER_META_KEY = 'HumanizerMetaV2'

export function getWarning(
  content: string,
  level: HumanizerWarning['level'] = 'caution'
): HumanizerWarning {
  return { content, level }
}
export const randomId = (): number => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

export function getLabel(content: string): HumanizerVisualization {
  return { type: 'label', content, id: randomId() }
}
export function getAction(content: string): HumanizerVisualization {
  return { type: 'action', content, id: randomId() }
}
export function getAddressVisualization(_address: string): HumanizerVisualization {
  const address = _address.toLowerCase()
  return { type: 'address', address, id: randomId() }
}

export function getToken(_address: string, amount: bigint): HumanizerVisualization {
  const address = _address.toLowerCase()
  return {
    type: 'token',
    address,
    amount: BigInt(amount),
    id: randomId()
  }
}

export function getChain(chainId: bigint): HumanizerVisualization {
  return { type: 'chain', id: randomId(), chainId }
}

export function getOnBehalfOf(onBehalfOf: string, sender: string): HumanizerVisualization[] {
  return onBehalfOf.toLowerCase() !== sender.toLowerCase()
    ? [getLabel('on behalf of'), getAddressVisualization(onBehalfOf)]
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
  const diff = BigInt(deadline) - BigInt(Date.now())

  if (diff < 0 && diff > -minute * 2n) return 'expired just now'
  if (diff < 0) return 'already expired'
  if (diff < minute) return 'expires in less than a minute'
  if (diff < 10n * minute) return `expires in ${Math.floor(Number(diff / minute))} minutes`
  return `valid until ${new Date(Number(deadline)).toLocaleString()}`
}

export function getDeadline(deadlineSecs: bigint | number): HumanizerVisualization {
  const deadline = BigInt(deadlineSecs) * 1000n
  return {
    type: 'deadline',
    amount: deadline,
    id: randomId()
  }
}

export function getHumanMessage(message: Uint8Array | string): HumanizerVisualization {
  return { type: 'message', messageContent: message, id: randomId() }
}
/**
 * Make a request to coingecko to fetch the latest price of the native token.
 * This is used by benzina and hence we cannot wrap the errors in emitError
 */
// @TODO this shouldn't be here, a more suitable place would be portfolio/gecko
export async function getNativePrice(network: Network, fetch: Fetch): Promise<number> {
  const platformId = geckoIdMapper(ZeroAddress, network)
  if (!platformId) {
    throw new Error(`getNativePrice: ${network.name} is not supported`)
  }

  const queryUrl = `${baseUrlCena}/simple/price?ids=${platformId}&vs_currencies=usd`
  let response = await fetch(queryUrl)
  response = await response.json()

  if (!response[platformId] || !response[platformId].usd) {
    throw new Error(`getNativePrice: could not fetch native token price for ${network.name} `)
  }

  return response[platformId].usd
}

// @TODO this should be moved outside of the humanizer as we should not use it in the humanizer
export async function getTokenInfo(
  humanizerSettings: HumanizerSettings,
  address: string,
  options: any
): Promise<HumanizerFragment | null> {
  let platformId = options?.network?.platformId
  if (!platformId) {
    options.emitError({
      message: 'getTokenInfo: could not find platform id for token info api',
      error: new Error(
        `could not find platform id for token info api ${humanizerSettings.networkId}`
      ),
      level: 'silent'
    })
    platformId = humanizerSettings.networkId
  }

  try {
    const queryUrl = `${baseUrlCena}/coins/${platformId}/contract/${address}`
    let response = await options.fetch(queryUrl)
    response = await response.json()
    if (response.symbol && response.detail_platforms?.[platformId]?.decimal_place)
      return {
        type: 'token',
        key: address.toLowerCase(),
        value: {
          symbol: response.symbol.toUpperCase(),
          decimals: response.detail_platforms?.[platformId]?.decimal_place
        },
        isGlobal: true
      }
    return null
  } catch (e: any) {
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
      ...[getLabel('and'), getAction('Send'), getToken(ZeroAddress, call.value)]
    )
  return unknownVisualization
}

export function getWrapping(
  address: string,
  amount: bigint,
  hiddenAssetAddress?: string
): HumanizerVisualization[] {
  return [
    getAction('Wrap'),
    getToken(address, amount),
    hiddenAssetAddress && { ...getToken(hiddenAssetAddress, 0n), isHidden: true }
  ].filter((x) => x) as HumanizerVisualization[]
}

export function getUnwrapping(
  address: string,
  amount: bigint,
  hiddenAssetAddress?: string
): HumanizerVisualization[] {
  return [
    getAction('Unwrap'),
    getToken(address, amount),
    hiddenAssetAddress && { ...getToken(hiddenAssetAddress, 0n), isHidden: true }
  ].filter((x) => x) as HumanizerVisualization[]
}

// @TODO cant this be used in the <Address component>
export function getKnownName(
  humanizerMeta: HumanizerMeta | undefined,
  address: string
): string | undefined {
  return humanizerMeta?.knownAddresses?.[address.toLowerCase()]?.name
}

export const integrateFragments = (
  _humanizerMeta: HumanizerMeta,
  fragments: HumanizerFragment[]
): HumanizerMeta => {
  const humanizerMeta = _humanizerMeta
  fragments.forEach((f) => {
    // @TODO rename types to singular  also add enum
    if (f.type === 'abis') humanizerMeta.abis[f.key] = f.value
    if (f.type === 'selector') humanizerMeta.abis.NO_ABI[f.key] = f.value
    if (f.type === 'knownAddresses')
      humanizerMeta.knownAddresses[f.key] = { ...humanizerMeta.knownAddresses[f.key], ...f.value }
    if (f.type === 'token') {
      humanizerMeta.knownAddresses[f.key] = {
        ...humanizerMeta.knownAddresses?.[f.key],
        token: f.value
      }
    }
  })
  return humanizerMeta
}

export const EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} }

export const uintToAddress = (uint: bigint): string =>
  `0x${BigInt(uint).toString(16).slice(-40).padStart(40, '0')}`

export const eToNative = (address: string): string =>
  address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? ZeroAddress : address
