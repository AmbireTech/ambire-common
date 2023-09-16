import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import { getLabel, getAction, getAddress, getNft, getToken, getTokenInfo } from '../utils'
import { HumanizerFragment, HumanizerCallModule, IrCall } from '../interfaces'

export const genericErc721Humanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const iface = new ethers.Interface(accountOp.humanizerMeta?.['abis:ERC721'])
  const nftTransferVisualization = (call: IrCall) => {
    const args = iface.parseTransaction(call)?.args.toArray() || []
    return args[0] === accountOp.accountAddr
      ? [getAction('Transfer'), getNft(call.to, args[2]), getLabel('to'), getAddress(args[1])]
      : [
          getAction('Transfer'),
          getNft(call.to, args[2]),
          getLabel('from'),
          getAddress(args[0]),
          getLabel('to'),
          getAddress(args[1])
        ]
  }
  const matcher = {
    [`${iface.getFunction('approve')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[0] === ethers.ZeroAddress
        ? [getAction('Revoke approval'), getLabel('for'), getNft(call.to, args[1])]
        : [
            getAction('Grant approval'),
            getLabel('for'),
            getNft(call.to, args[1]),
            getLabel('to'),
            getAddress(args[0])
          ]
    },
    [`${iface.getFunction('setApprovalForAll')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[1]
        ? [
            getAction('Grant approval'),
            getLabel('for all nfts'),
            getNft(call.to, args[1]),
            getLabel('to'),
            getAddress(args[0])
          ]
        : [getAction('Revoke approval'), getLabel('for all nfts'), getAddress(args[0])]
    },
    // not in tests
    [`${iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256'])?.selector}`]:
      nftTransferVisualization,
    // [`${
    //   iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256', 'bytes'])
    //     ?.selector
    // }`]: nftTransferVisualization,
    [`${iface.getFunction('transferFrom', ['address', 'address', 'uint256'])?.selector}`]:
      nftTransferVisualization
  }

  const newCalls = currentIrCalls.map((call) => {
    return matcher[call.data.substring(0, 10)] // could do additional check if it is actually NFT contract
      ? {
          ...call,
          fullVisualization: matcher[call.data.substring(0, 10)](call)
        }
      : call
  })
  return [newCalls, []]
}

export const genericErc20Humanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  options?: any
) => {
  const asyncOps: Promise<HumanizerFragment | null>[] = []
  const iface = new ethers.Interface(accountOp.humanizerMeta?.['abis:ERC20'])
  const matcher = {
    [`${iface.getFunction('approve')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[1] !== BigInt(0)
        ? [
            getAction('Grant approval'),
            getToken(call.to, args[1]),
            getLabel('to'),
            getAddress(args[0])
          ]
        : [
            getAction('Revoke approval'),
            getToken(call.to, args[1]),
            getLabel('for'),
            getAddress(args[0])
          ]
    },
    [`${iface.getFunction('transfer')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return [
        getAction('Transfer'),
        getToken(call.to, args[1]),
        getLabel('to'),
        getAddress(args[0])
      ]
    },
    [`${iface.getFunction('transferFrom')?.selector}`]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      if (args[0] === accountOp.accountAddr) {
        return [
          getAction('Transfer'),
          getToken(call.to, args[2]),
          getLabel('to'),
          getAddress(args[1])
        ]
      }
      if (args[1] === accountOp.accountAddr) {
        return [
          getAction('Take'),
          getToken(call.to, args[2]),
          getLabel('from'),
          getAddress(args[0])
        ]
      }
      return [
        getAction('Move'),
        getToken(call.to, args[2]),
        getLabel('from'),
        getAddress(args[0]),
        getLabel('to'),
        getAddress(args[1])
      ]
    }
  }
  const newCalls = currentIrCalls.map((call) => {
    // if proper func selector and no such token found in meta
    if (matcher[call.data.substring(0, 10)] && !accountOp.humanizerMeta?.[`tokens:${call.to}`]) {
      const asyncTokenInfo = getTokenInfo(accountOp, call.to, options)
      asyncOps.push(asyncTokenInfo)
    }
    if (matcher[call.data.substring(0, 10)] && accountOp.humanizerMeta?.[`tokens:${call.to}`])
      return {
        ...call,
        fullVisualization: matcher[call.data.substring(0, 10)](call)
      }
    if (accountOp.humanizerMeta?.[`tokens:${call.to}`] && !matcher[call.data.substring(0, 10)])
      return {
        ...call,
        fullVisualization: [
          getAction('Unknown action (erc20)'),
          getLabel('to'),
          getAddress(call.to)
        ]
      }
    return call
  })
  return [newCalls, asyncOps]
}
