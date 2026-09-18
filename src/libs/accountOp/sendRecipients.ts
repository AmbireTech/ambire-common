import { getAddress } from 'ethers'
import { decodeFunctionData, Hex, parseAbi, toFunctionSelector } from 'viem'

import { Call } from './types'

// `transferFrom(address,address,uint256)` is shared by ERC20 and ERC721, so one entry covers both
const transferAbi = parseAbi(['function transfer(address to, uint256 amountOrTokenId)'])
const transferFromAbi = parseAbi([
  'function transferFrom(address from, address to, uint256 amountOrTokenId)'
])
const safeTransferFromAbi = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId)'
])
const safeTransferFromWithDataAbi = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)'
])

/**
 * Which decoded argument holds the recipient, per function that moves funds to someone else.
 * Everything not listed here is a contract interaction rather than a send.
 */
const RECIPIENT_ARG_INDEX_BY_SELECTOR: Record<string, { abi: any; index: number; args: number }> = {
  [toFunctionSelector(transferAbi[0])]: { abi: transferAbi, index: 0, args: 2 },
  [toFunctionSelector(transferFromAbi[0])]: { abi: transferFromAbi, index: 1, args: 3 },
  [toFunctionSelector(safeTransferFromAbi[0])]: { abi: safeTransferFromAbi, index: 1, args: 3 },
  [toFunctionSelector(safeTransferFromWithDataAbi[0])]: {
    abi: safeTransferFromWithDataAbi,
    index: 1,
    args: 3
  }
}

const getRecipientFromCall = (call: Call): string | null => {
  const data = (call.data || '0x') as Hex

  // A plain value transfer - the call target is the recipient
  if (data === '0x') return call.value > 0n && call.to ? call.to : null

  const decoder = RECIPIENT_ARG_INDEX_BY_SELECTOR[data.slice(0, 10)]
  if (!decoder) return null

  try {
    // Some tokens send shorter calldata than the ABI expects, the same way the humanizer pads it
    const expectedLength = 2 + 8 + decoder.args * 64
    const { args } = decodeFunctionData({
      abi: decoder.abi,
      data: data.padEnd(expectedLength, '0') as Hex
    })

    return (args[decoder.index] as string) || null
  } catch {
    // Not actually the function the selector suggests, so there is no recipient to read
    return null
  }
}

/**
 * The addresses an account op sends funds to - native plus ERC20/ERC721 transfers. Contract
 * interactions are left out: the dapp side of the signing authentication covers those.
 */
export const getSendRecipients = (calls: Call[]): string[] => {
  const recipients = new Set<string>()

  calls.forEach((call) => {
    const recipient = getRecipientFromCall(call)
    if (!recipient) return

    try {
      recipients.add(getAddress(recipient))
    } catch {
      // A malformed address can never have been sent to, so it is not worth prompting about
    }
  })

  return Array.from(recipients)
}
