// @TODO not ready, do todos
import { ethers } from 'ethers'
import { AccountOp } from 'libs/accountOp/accountOp'
import { HumanizerFragment, Ir, IrCall } from '../interfaces'
import { getAction, getLable, getToken } from '../utils'

const parseZeroAddressIfNeeded = (address: string) => {
  return address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ? '0x0000000000000000000000000000000000000000'
    : address
}

const OneInchMapping = (humanizerInfo: any) => {
  const iface = new ethers.Interface(humanizerInfo?.['abis:Swappin'])

  return {
    [`${iface.getFunction('swap')}`]: (accounutOp: AccountOp, call: IrCall) => {
      const { desc } = iface.parseTransaction(call)!.args
      return [
        getAction('Swap'),
        getToken(parseZeroAddressIfNeeded(desc.srcToken), desc.amount),
        getLable('for at least'),
        getToken(parseZeroAddressIfNeeded(desc.dstToken), desc.minReturnAmount)
      ]
    },
    [`${iface.getFunction('unoswap')}`]: (accounutOp: AccountOp, call: IrCall) => {
      const { amount, minReturn, srcToken } = iface.parseTransaction(call)!.args

      return [
        getAction('Swap'),
        getToken(parseZeroAddressIfNeeded(srcToken), amount),
        getLable('for at least'),
        // @TODO not correct look at next comment
        getToken(parseZeroAddressIfNeeded(ethers.ZeroAddress), minReturn)
        // @TODO no idea what this is, ask Lubo (taken from ambire wallet)
        // getToken(parseZeroAddressIfNeeded(dstToken), minReturn)
      ]
    }
  }
}

// @TODO why was swappin gifts in 1inch, ask Lubo
// const SwappinMapping = (humanizerInfo: any) => {
//   const iface = new ethers.Interface(humanizerInfo.abis.SwappinOwn)

//   return {
//     [`${iface.getFunction('payWithEth')}`]: (accounutOp: AccountOp, call: IrCall) => {
//       const { amountFrom } = iface.parseTransaction(call)!.args
//       return !opts.extended
//         ? [`Pay with ${nativeToken(network, amountFrom, opts.extended)} for a gift card`]
//         : toExtended(
//             'Swapping',
//             'for a gift card on Swappin.gifts',
//             nativeToken(network, amountFrom, opts.extended)
//           )
//     },
//     [`${iface.getFunction('payWithUsdToken')}`]: (accounutOp: AccountOp, call: IrCall) => {
//       const { amount, token: destToken } = iface.parseTransaction(call)!.args
//       return !opts.extended
//         ? [`Pay with ${token(humanizerInfo, destToken, amount)} for a gift card`]
//         : toExtended(
//             'Swapping',
//             'for a gift card on Swappin.gifts',
//             token(humanizerInfo, destToken, amount, opts.extended)
//           )
//     },
//     [`${iface.getFunction('payWithAnyToken')}`]: (accounutOp: AccountOp, call: IrCall) => {
//       const { amountFrom, tokenFrom } = iface.parseTransaction(call)!.args
//       return !opts.extended
//         ? [`Pay with ${token(humanizerInfo, tokenFrom, amountFrom, opts.extended)} for a gift card`]
//         : toExtended(
//             'Swapping',
//             'for a gift card on Swappin.gifts',
//             token(humanizerInfo, tokenFrom, amountFrom, opts.extended)
//           )
//     }
//   }
// }

// @TODO check if it is correct humanization
// @TODO find contract addresses and add them to matcher
export const oneInchHumanizer = (
  accountOp: AccountOp,
  ir: Ir
): [Ir, Array<Promise<HumanizerFragment>>] => {
  const matcher = {
    ...OneInchMapping(accountOp.humanizerMeta)
    // ...SwappinMapping(accountOp.humanizerMeta)
  }
  const newCalls: IrCall[] = []
  ir.calls.forEach((call) => {
    if (call.to === '0x1111111254fb6c44bAC0beD2854e76F90643097d') {
      matcher[call.data.slice(0, 10)]
        ? newCalls.push({
            ...call,
            fullVisualization: matcher[call.data.slice(0, 10)](accountOp, call)
          })
        : newCalls.push({ ...call, fullVisualization: [getAction('Unknown action (1inch)')] })
    } else {
      newCalls.push(call)
    }
  })
  return [{ calls: newCalls }, []]
}
