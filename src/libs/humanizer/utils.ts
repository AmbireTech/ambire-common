import { ethers } from 'ethers'
import { AccountOp } from 'libs/accountOp/accountOp'
import { HumanizerFragment, HumanizerVisualization } from './interfaces'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { networks } from '../../consts/networks'

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
    ? ([getLabel('on befalf of'), getAddress(onBehalfOf, name)] as HumanizerVisualization[])
    : []
}

// @TODO on some humanization of uniswap there is recipient 0x000...000
export function getRecipientText(from: string, recipient: string): HumanizerVisualization[] {
  return from.toLowerCase() === recipient.toLowerCase()
    ? []
    : ([getLabel('and send it to'), getAddress(recipient)] as HumanizerVisualization[])
}

export function getDeadlineText(
  deadlineSecs: bigint,
  mined = false
): HumanizerVisualization | null {
  if (mined) return null
  const minute = 60000
  const deadline = Number(deadlineSecs * 1000n)
  const diff = deadline - Date.now()
  if (diff < 0 && diff > -minute * 2) return getLabel('expired just now')
  // Disabled this: this is a bit of a hack cause we don't want it to show for mined txns
  // we don't really need it for pending ones, simply because we'll show the big error message instead
  // if (diff < 0) return getLabel(`, expired ${Math.floor(-diff / minute)} minutes ago`
  if (diff < 0) return getLabel('already expired')
  if (diff < minute) return getLabel('expires in less than a minute')
  if (diff < 10 * minute) return getLabel(`expires in ${Math.floor(diff / minute)} minutes`)
  return null
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
    const response = await (
      await options.fetch(`https://api.coingecko.com/api/v3/coins/${network}/contract/${address}`)
    ).json()
    if (response.symbol && response.detail_platforms?.ethereum.decimal_place)
      return {
        key: `tokens:${address}`,
        isGlobal: true,
        value: [response.symbol.toUpperCase(), response.detail_platforms?.ethereum.decimal_place]
      }
    options.emitError({
      message: 'getTokenInfo: something is wrong with coingecko api',
      error: new Error('The response from coingecko had unexpected json structure'),
      level: 'minor'
    })
    return null
  } catch (e) {
    return options.emitError({
      message: 'getTokenInfo: something is wrong with coingecko api',
      error: e,
      level: 'minor'
    })
  }
}

export function checkIfUnknowAction(v: Array<HumanizerVisualization>) {
  try {
    return v[0].type === 'action' && v?.[0]?.content?.startsWith('Unknown action')
  } catch (e) {
    return false
  }
}
