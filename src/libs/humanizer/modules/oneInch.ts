import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../../interfaces/humanizer'
import { getAction, getLabel, getToken, getUnknownVisualization } from '../utils'

const parseZeroAddressIfNeeded = (address: string) => {
  return address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ? '0x0000000000000000000000000000000000000000'
    : address
}

const OneInchMapping = (humanizerInfo: any) => {
  const iface = new ethers.Interface(humanizerInfo?.['abis:Swappin'])

  return {
    [iface.getFunction('swap')?.selector!]: (accounutOp: AccountOp, call: IrCall) => {
      const { desc } = iface.parseTransaction(call)!.args
      return [
        getAction('Swap'),
        getToken(parseZeroAddressIfNeeded(desc.srcToken), desc.amount),
        getLabel('for at least'),
        getToken(parseZeroAddressIfNeeded(desc.dstToken), desc.minReturnAmount)
      ]
    },
    [iface.getFunction('unoswap')?.selector!]: (accounutOp: AccountOp, call: IrCall) => {
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
  const newCalls = irCalls.map((call) => {
    if (call.to === '0x1111111254fb6c44bAC0beD2854e76F90643097d') {
      const sigHash = call.data.slice(0, 10)

      return matcher[sigHash]
        ? {
            ...call,
            fullVisualization: matcher[sigHash](accountOp, call)
          }
        : {
            ...call,
            fullVisualization: getUnknownVisualization('1inch', call)
          }
    }
    return call
  })
  return [newCalls, []]
}
