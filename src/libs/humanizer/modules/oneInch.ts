import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../interfaces'
import { getAction, getLabel, getToken, getAddress } from '../utils'

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
        getLabel('for at least'),
        getToken(parseZeroAddressIfNeeded(desc.dstToken), desc.minReturnAmount)
      ]
    },
    [`${iface.getFunction('unoswap')}`]: (accounutOp: AccountOp, call: IrCall) => {
      const { amount, minReturn, srcToken } = iface.parseTransaction(call)!.args

      return [
        getAction('Swap'),
        getToken(parseZeroAddressIfNeeded(srcToken), amount),
        getLabel('for at least'),
        // @TODO not correct look at next comment
        getToken(parseZeroAddressIfNeeded(ethers.ZeroAddress), minReturn)
        // @TODO no idea what this is, ask Lubo (taken from ambire wallet)
        // getToken(parseZeroAddressIfNeeded(dstToken), minReturn)
      ]
    }
  }
}
export const oneInchHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const matcher = {
    ...OneInchMapping(accountOp.humanizerMeta)
  }
  const newCalls: IrCall[] = []
  irCalls.forEach((call) => {
    if (call.to === '0x1111111254fb6c44bAC0beD2854e76F90643097d') {
      matcher[call.data.slice(0, 10)]
        ? newCalls.push({
            ...call,
            fullVisualization: matcher[call.data.slice(0, 10)](accountOp, call)
          })
        : newCalls.push({
            ...call,
            fullVisualization: [
              getAction('Unknown action (1inch)'),
              getLabel('to'),
              getAddress(call.to)
            ]
          })
    } else {
      newCalls.push(call)
    }
  })
  return [newCalls, []]
}
