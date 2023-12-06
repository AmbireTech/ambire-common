import dotenv from 'dotenv'
import { ethers } from 'ethers'

import { geckoNetworkIdMapper } from '../../consts/coingecko'
import { networks } from '../../consts/networks'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import {
  HumanizerFragment,
  HumanizerSettings,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall
} from '../../interfaces/humanizer'

dotenv.config()
const COINGECKO_PRO_API_KEY = process.env.COINGECKO_PRO_API_KEY

export function getWarning(content: string, level: HumanizerWarning['level'] = 'caution') {
  return { content, level }
}

export function getLabel(content: string): HumanizerVisualization {
  return { type: 'label', content }
}
export function getAction(content: string): HumanizerVisualization {
  return { type: 'action', content }
}
export function getAddress(_address: string, name?: string): HumanizerVisualization {
  const address = ethers.getAddress(_address)
  return name ? { type: 'address', address, name } : { type: 'address', address }
}

export function getToken(_address: string, amount: bigint, name?: string): HumanizerVisualization {
  const address = ethers.getAddress(_address)
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
    ? [getLabel('on befalf of'), getAddress(onBehalfOf, name)]
    : []
}

// @TODO on some humanization of uniswap there is recipient 0x000...000
export function getRecipientText(from: string, recipient: string): HumanizerVisualization[] {
  return from.toLowerCase() === recipient.toLowerCase()
    ? []
    : [getLabel('and send it to'), getAddress(recipient)]
}

export function getDeadlineText(deadlineSecs: bigint): HumanizerVisualization {
  if (
    deadlineSecs.toString() ===
    '115792089237316195423570985008687907853269984665640564039457584007913129639935'
  )
    return getLabel('no deadline')
  const minute = 60000
  const deadline = Number(BigInt(deadlineSecs) * 1000n)
  const diff = deadline - Date.now()
  if (diff < 0 && diff > -minute * 2) return getLabel('expired just now')
  if (diff < 0) return getLabel('already expired')
  if (diff < minute) return getLabel('expires in less than a minute')
  if (diff < 10 * minute) return getLabel(`expires in ${Math.floor(diff / minute)} minutes`)
  return getLabel(`valid until ${new Date(deadline).toLocaleString()}`)
}

export function shortenAddress(addr: string) {
  return addr ? `${addr.slice(0, 5)}...${addr.slice(-3)}` : null
}

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
        key: `tokens:${address}`,
        isGlobal: true,
        value: [response.symbol.toUpperCase(), response.detail_platforms?.ethereum?.decimal_place]
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

export function checkIfUnknownAction(v: Array<HumanizerVisualization>) {
  try {
    return v[0].type === 'action' && v?.[0]?.content?.startsWith('Unknown action')
  } catch (e) {
    return false
  }
}

export function getUnknownVisualization(name: string, call: IrCall) {
  const unknownVisualization = [
    getAction(`Unknown action (${name})`),
    getLabel('to'),
    getAddress(call.to)
  ]
  if (call.value)
    unknownVisualization.push(
      ...[getLabel('and'), getAction('Send'), getToken(ethers.ZeroAddress, call.value)]
    )
  return unknownVisualization
}

export function getWraping(address: string, amount: bigint) {
  return [getAction('Wrap'), getToken(address, amount)]
}

export function getUnwraping(address: string, amount: bigint) {
  return [getAction('Unwrap'), getToken(address, amount)]
}
