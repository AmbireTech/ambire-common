import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { ERC20, ERC721 } from '../../const/abis'
import { HumanizerCallModule, HumanizerPromise, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getNft, getToken } from '../../utils'

// @TODO merge this with the  erc20 humanizer module as sometimes
// we see no difference between the two
export const genericErc721Humanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const iface = new Interface(ERC721)
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
    // could do additional check if it is actually NFT contract
    return matcher[call.data.substring(0, 10)]
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
  currentIrCalls: IrCall[]
) => {
  const asyncOps: HumanizerPromise[] = []
  const iface = new Interface(ERC20)
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
    return matcher[sigHash]
      ? {
          ...call,
          fullVisualization: matcher[sigHash](call)
        }
      : call
  })
  return [newCalls, asyncOps]
}
