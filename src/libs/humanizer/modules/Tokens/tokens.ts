import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { ERC20, ERC721 } from '../../const/abis'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'

const ERC721_INTERFACE = new Interface(ERC721)
const ERC20_INTERFACE = new Interface(ERC20)

// @TODO merge this with the  erc20 humanizer module as sometimes
// we see no difference between the two
export const genericErc721Humanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const nftTransferVisualization = (call: IrCall) => {
    if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
    const args = ERC721_INTERFACE.parseTransaction(call)?.args.toArray() || []
    return args[0] === accountOp.accountAddr
      ? [
          getAction('Send'),
          getToken(call.to, args[2]),
          getLabel('to'),
          getAddressVisualization(args[1])
        ]
      : [
          getAction('Transfer'),
          getToken(call.to, args[2]),
          getLabel('from'),
          getAddressVisualization(args[0]),
          getLabel('to'),
          getAddressVisualization(args[1])
        ]
  }
  const matcher = {
    [ERC721_INTERFACE.getFunction('approve')?.selector!]: (call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const args = ERC721_INTERFACE.parseTransaction(call)?.args.toArray() || []
      return args[0] === ZeroAddress
        ? [getAction('Revoke approval'), getLabel('for'), getToken(call.to, args[1])]
        : [
            getAction('Grant approval'),
            getLabel('for'),
            getToken(call.to, args[1]),
            getLabel('to'),
            getAddressVisualization(args[0])
          ]
    },
    [ERC721_INTERFACE.getFunction('setApprovalForAll')?.selector!]: (call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const args = ERC721_INTERFACE.parseTransaction(call)?.args.toArray() || []
      return args[1]
        ? [
            getAction('Grant approval', { warning: true }),
            getLabel('for all NFTs of'),
            getAddressVisualization(call.to),
            getLabel('to'),
            getAddressVisualization(args[0])
          ]
        : [
            getAction('Revoke approval'),
            getLabel('for all nfts from'),
            getAddressVisualization(call.to),
            getLabel('for'),
            getAddressVisualization(args[0])
          ]
    },
    // not in tests
    [ERC721_INTERFACE.getFunction('safeTransferFrom', ['address', 'address', 'uint256'])
      ?.selector!]: nftTransferVisualization,
    // [`${
    //   ERC721_INTERFACE.getFunction('safeTransferFrom', ['address', 'address', 'uint256', 'bytes'])
    //     ?.selector
    // }`]: nftTransferVisualization,
    [ERC721_INTERFACE.getFunction('transferFrom', ['address', 'address', 'uint256'])?.selector!]:
      nftTransferVisualization
  }

  const newCalls = currentIrCalls.map((call) => {
    if (!call.to) return call
    // could do additional check if it is actually NFT contract
    return matcher[call.data.substring(0, 10)]
      ? {
          ...call,
          fullVisualization: matcher[call.data.substring(0, 10)](call)
        }
      : call
  })
  return newCalls
}

export const genericErc20Humanizer = (
  { accountAddr }: { accountAddr: string },
  currentIrCalls: IrCall[]
): IrCall[] => {
  const matcher = {
    [ERC20_INTERFACE.getFunction('approve')?.selector!]: (call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const args = ERC20_INTERFACE.parseTransaction(call)?.args.toArray() || []
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
    [ERC20_INTERFACE.getFunction('increaseAllowance')?.selector!]: (call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { spender, addedValue } = ERC20_INTERFACE.decodeFunctionData(
        'increaseAllowance',
        call.data
      )

      return [
        getAction('Increase allowance'),
        getLabel('of'),
        getAddressVisualization(spender),
        getLabel('with'),
        getToken(call.to, addedValue)
      ]
    },

    [ERC20_INTERFACE.getFunction('decreaseAllowance')?.selector!]: (call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const { spender, subtractedValue } = ERC20_INTERFACE.decodeFunctionData(
        'decreaseAllowance',
        call.data
      )

      return [
        getAction('Decrease allowance'),
        getLabel('of'),
        getAddressVisualization(spender),
        getLabel('with'),
        getToken(call.to, subtractedValue)
      ]
    },
    [ERC20_INTERFACE.getFunction('transfer')?.selector!]: (call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')

      const args = ERC20_INTERFACE.parseTransaction(call)?.args.toArray() || []
      return [
        getAction('Send'),
        getToken(call.to, args[1]),
        getLabel('to'),
        getAddressVisualization(args[0])
      ]
    },
    [ERC20_INTERFACE.getFunction('transferFrom')?.selector!]: (call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in tokens module if !call.to')
      const args = ERC20_INTERFACE.parseTransaction(call)?.args.toArray() || []
      if (args[0] === accountAddr) {
        return [
          getAction('Transfer'),
          getToken(call.to, args[2]),
          getLabel('to'),
          getAddressVisualization(args[1])
        ]
      }
      if (args[1] === accountAddr) {
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
    if (!call.to) return call
    return matcher[sigHash]
      ? {
          ...call,
          fullVisualization: matcher[sigHash](call)
        }
      : call
  })
  return newCalls
}
