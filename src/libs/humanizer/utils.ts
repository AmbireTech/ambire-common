import { ethers } from 'ethers'
import { AccountOp } from 'libs/accountOp/accountOp'
import { HumanizerFragment } from './interfaces'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { networks } from '../../consts/networks'

export function getLable(content: string) {
  return { type: 'lable', content }
}
export function getAction(content: string) {
  return { type: 'action', content }
}
export function getAddress(_address: string, name?: string) {
  const address = ethers.getAddress(_address)
  return name ? { type: 'address', address, name } : { type: 'address', address }
}

export function getToken(_address: string, amount: bigint, name?: string) {
  const address = ethers.getAddress(_address)
  return name ? { type: 'token', address, amount, name } : { type: 'token', address, amount }
}

export function getNft(address: string, id: bigint) {
  return { type: 'nft', address, id }
}

export function getOnBehalfOf(onBehalfOf: string, sender: string, name?: string) {
  return onBehalfOf.toLowerCase() !== sender.toLowerCase()
    ? [getLable('on befalf of'), getAddress(onBehalfOf, name)]
    : []
}

// @TODO on some humanization of uniswap there is recipient 0x000...000
export function getRecipientText(from: string, recipient: string) {
  return from.toLowerCase() === recipient.toLowerCase()
    ? []
    : [getLable('and send it to'), getAddress(recipient)]
}
export function parsePath(pathBytes: any) {
  // some decodePacked fun
  // can we do this with Ethers AbiCoder? probably not
  const path = []
  // address, uint24
  for (let i = 2; i < pathBytes.length; i += 46) {
    path.push(`0x${pathBytes.substr(i, 40)}`)
  }
  return path
}

export function getDeadlineText(deadlineSecs: bigint, mined = false) {
  if (mined) return null
  const minute = 60000
  const deadline = Number(deadlineSecs * 1000n)
  const diff = deadline - Date.now()
  if (diff < 0 && diff > -minute * 2) return getLable('expired just now')
  // Disabled this: this is a bit of a hack cause we don't want it to show for mined txns
  // we don't really need it for pending ones, simply because we'll show the big error message instead
  // if (diff < 0) return getLable(`, expired ${Math.floor(-diff / minute)} minutes ago`
  if (diff < 0) return getLable('already expired')
  if (diff < minute) return getLable('expires in less than a minute')
  if (diff < 10 * minute) return getLable(`expires in ${Math.floor(diff / minute)} minutes`)
  return null
}

export function shortenAddress(addr: string) {
  return addr ? `${addr.slice(0, 5)}...${addr.slice(-3)}` : null
}

export async function getTokenInfo(
  accountOp: AccountOp,
  address: string,
  fetch: Function
): Promise<HumanizerFragment | null> {
  // @TODO update networks list
  const network = networks.find(
    (n: NetworkDescriptor) => n.chainId === BigInt(accountOp.networkId)
  )?.id
  try {
    // @TODO update to use wrapper for coingecko api (if (no key) {free api} else {paid api})
    const response = await (
      await fetch(`https://api.coingecko.com/api/v3/coins/${network}/contract/${address}`)
    ).json()

    if (response.symbol && response.detail_platforms?.ethereum.decimal_place)
      return {
        key: `tokens:${address}`,
        isGlobal: true,
        value: [response.symbol.toUpperCase(), response.detail_platforms?.ethereum.decimal_place]
      }
    return null
  } catch (e) {
    return null
  }
}
