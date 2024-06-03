import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, HumanizerPromise, IrCall } from '../interfaces'
import {
  getAction,
  getAddressVisualization,
  getKnownAbi,
  getKnownToken,
  getLabel,
  getNft,
  getToken,
  getTokenInfo,
  getUnknownVisualization
} from '../utils'

export const genericErc721Humanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  humanizerMeta: HumanizerMeta,
  options?: any
) => {
  const iface = new Interface(getKnownAbi(humanizerMeta, 'ERC721', options))
  const nftTransferVisualization = (call: IrCall) => {
    const args = iface.parseTransaction(call)?.args.toArray() || []
    return args[0] === accountOp.accountAddr
      ? [
          getAction('Send'),
          getNft(call.to, args[2]),
          getLabel('to'),
          getAddressVisualization(args[1])
        ]
      : [
          getAction('Transfer'),
          getNft(call.to, args[2]),
          getLabel('from'),
          getAddressVisualization(args[0]),
          getLabel('to'),
          getAddressVisualization(args[1])
        ]
  }
  const matcher = {
    [iface.getFunction('approve')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[0] === ZeroAddress
        ? [getAction('Revoke approval'), getLabel('for'), getNft(call.to, args[1])]
        : [
            getAction('Grant approval'),
            getLabel('for'),
            getNft(call.to, args[1]),
            getLabel('to'),
            getAddressVisualization(args[0])
          ]
    },
    [iface.getFunction('setApprovalForAll')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[1]
        ? [
            getAction('Grant approval'),
            getLabel('for all nfts'),
            getNft(call.to, args[1]),
            getLabel('to'),
            getAddressVisualization(args[0])
          ]
        : [getAction('Revoke approval'), getLabel('for all nfts'), getAddressVisualization(args[0])]
    },
    // not in tests
    [iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256'])?.selector!]:
      nftTransferVisualization,
    // [`${
    //   iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256', 'bytes'])
    //     ?.selector
    // }`]: nftTransferVisualization,
    [iface.getFunction('transferFrom', ['address', 'address', 'uint256'])?.selector!]:
      nftTransferVisualization
  }

  const newCalls = currentIrCalls.map((call) => {
    // the humanizer works like this:
    // first, humanize ERC-20
    // second, humanize ERC-721
    // but the sigHash for approve is the same on both standards
    // so on approve, ERC-20 humanization is replaced by ERC-721.
    // that's why we check if it's a known token to prevent humanization.
    // If it's not a known token, using the same humanization is okay as
    // we cannot humanize it further
    const isActuallyKnownToken = !!getKnownToken(humanizerMeta, call.to)
    // could do additional check if it is actually NFT contract
    return matcher[call.data.substring(0, 10)] && !isActuallyKnownToken
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
  humanizerMeta: HumanizerMeta,
  options?: any
) => {
  const asyncOps: HumanizerPromise[] = []
  const iface = new Interface(getKnownAbi(humanizerMeta, 'ERC20', options))
  const matcher = {
    [iface.getFunction('approve')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[1] !== BigInt(0)
        ? [
            getAction('Grant approval'),
            getLabel('for'),
            getToken(call.to, args[1]),
            getLabel('to'),
            getAddressVisualization(args[0])
          ]
        : [
            getAction('Revoke approval'),
            getToken(call.to, args[1]),
            getLabel('for'),
            getAddressVisualization(args[0])
          ]
    },
    [iface.getFunction('transfer')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return [
        getAction('Send'),
        getToken(call.to, args[1]),
        getLabel('to'),
        getAddressVisualization(args[0])
      ]
    },
    [iface.getFunction('transferFrom')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      if (args[0] === accountOp.accountAddr) {
        return [
          getAction('Transfer'),
          getToken(call.to, args[2]),
          getLabel('to'),
          getAddressVisualization(args[1])
        ]
      }
      if (args[1] === accountOp.accountAddr) {
        return [
          getAction('Take'),
          getToken(call.to, args[2]),
          getLabel('from'),
          getAddressVisualization(args[0])
        ]
      }
      return [
        getAction('Move'),
        getToken(call.to, args[2]),
        getLabel('from'),
        getAddressVisualization(args[0]),
        getLabel('to'),
        getAddressVisualization(args[1])
      ]
    }
  }
  const newCalls = currentIrCalls.map((call) => {
    const sigHash = call.data.substring(0, 10)
    const isToKnownToken = !!getKnownToken(humanizerMeta, call.to)
    // if proper func selector and no such token found in meta
    // console.log(matcher[sigHash], isToKnownToken)
    if (matcher[sigHash] && !isToKnownToken)
      asyncOps.push(() => getTokenInfo(accountOp, call.to, options))

    if (matcher[sigHash] && isToKnownToken)
      return {
        ...call,
        fullVisualization: matcher[sigHash](call)
      }

    if (isToKnownToken && !matcher[sigHash])
      return {
        ...call,
        fullVisualization: getUnknownVisualization('ERC-20', call)
      }
    return call
  })
  return [newCalls, asyncOps]
}
