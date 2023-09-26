import { ethers } from 'ethers'
import { AccountOp } from 'libs/accountOp/accountOp'
import { HumanizerFragment, HumanizerVisualization } from './interfaces'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { networks } from '../../consts/networks'

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY

export function getWarning(content: string, level: string = 'caution') {
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
  const minute = 60000
  const deadline = Number(deadlineSecs * 1000n)
  const diff = deadline - Date.now()
  if (diff < 0 && diff > -minute * 2) return getLabel('expired just now')
  if (diff < 0) return getLabel('already expired')
  if (diff < minute) return getLabel('expires in less than a minute')
  if (diff < 10 * minute) return getLabel(`expires in ${Math.floor(diff / minute)} minutes`)
  return getLabel(`valid until ${new Date(deadline * 1000).toLocaleString()}`)
}

export function shortenAddress(addr: string) {
  return addr ? `${addr.slice(0, 5)}...${addr.slice(-3)}` : null
}

export async function getTokenInfo(
  accountOp: AccountOp,
  address: string,
  options: any
): Promise<HumanizerFragment | null> {
  const network = networks.find(
    (n: NetworkDescriptor) => n.chainId === BigInt(accountOp.networkId)
  )?.id
  // @TODO update coingecko call with https://github.com/AmbireTech/ambire-common/pull/328
  try {
    const baseUrl = COINGECKO_API_KEY
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3'
    const postfix = COINGECKO_API_KEY ? `&x_cg_pro_api_key=${COINGECKO_API_KEY}` : ''
    const coingeckoQueryUrl = `${baseUrl}/coins/${network}/contract/${address}${postfix}`

    const response = await (await options.fetch(coingeckoQueryUrl)).json()
    if (response.symbol && response.detail_platforms?.ethereum.decimal_place)
      return {
        key: `tokens:${address}`,
        isGlobal: true,
        value: [response.symbol.toUpperCase(), response.detail_platforms?.ethereum.decimal_place]
      }
    options.emitError({
      message: 'getTokenInfo: something is wrong goingecko reponse format',
      error: new Error('unexpected response format'),
      level: 'minor'
    })
    return null
  } catch (e) {
    options.emitError({
      message: 'getTokenInfo: something is wrong with coingecko api',
      error: e,
      level: 'minor'
    })
    return null
  }
}

export function checkIfUnknowAction(v: Array<HumanizerVisualization>) {
  try {
    return v[0].type === 'action' && v?.[0]?.content?.startsWith('Unknown action')
  } catch (e) {
    return false
  }
}
