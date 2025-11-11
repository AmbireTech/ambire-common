import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { JoeRouter } from '../../const/abis'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getDeadline, getLabel, getRecipientText, getToken } from '../../utils'

// @TODO limit order manager
// @TODO those use AVAX in the function method
// https://snowtrace.io/address/0x60aE616a2155Ee3d9A68541Ba4544862310933d4
// https://arbiscan.io/address/0xbeE5c10Cf6E4F68f831E11C1D9E59B43560B3642
// https://arbiscan.io/address/0x7BFd7192E76D950832c77BB412aaE841049D8D9B
const traderJoeModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface(JoeRouter)
  const matcher = {
    [iface.getFunction(
      'swapExactNATIVEForTokens(uint256 amountOutMin,(uint256[],uint8[],address[]) path,address to,uint256 deadline)'
    )?.selector!]: (call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { amountOutMin, path, to, deadline } = iface.parseTransaction(call)!.args
      const tokenOut = path[2][path[2].length - 1]
      return [
        getAction('Swap'),
        getToken(ZeroAddress, call.value),
        getLabel('for at least'),
        getToken(tokenOut, amountOutMin),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [iface.getFunction(
      'swapNATIVEForExactTokens(uint256 amountOut,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)'
    )?.selector!]: (call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { amountOut, path, to, deadline } = iface.parseTransaction(call)!.args
      const tokenOut = path[2][path[2].length - 1]
      return [
        getAction('Swap up to'),
        getToken(ZeroAddress, call.value),
        getLabel('for'),
        getToken(tokenOut, amountOut),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [iface.getFunction(
      'swapExactTokensForNATIVE(uint256 amountIn,uint256 amountOutMinNATIVE,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)'
    )?.selector!]: (call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { amountIn, amountOutMinNATIVE, path, to, deadline } =
        iface.parseTransaction(call)!.args
      return [
        getAction('Swap'),
        getToken(path[2][0], amountIn),
        getLabel('for at least'),
        getToken(ZeroAddress, amountOutMinNATIVE),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [iface.getFunction(
      'swapTokensForExactNATIVE(uint256 amountNATIVEOut,uint256 amountInMax,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)'
    )?.selector!]: (call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { amountNATIVEOut, amountInMax, path, to, deadline } =
        iface.parseTransaction(call)!.args
      return [
        getAction('Swap up to'),
        getToken(path[2][0], amountInMax),
        getLabel('for'),
        getToken(ZeroAddress, amountNATIVEOut),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [iface.getFunction(
      'swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)'
    )?.selector!]: (call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { amountIn, amountOutMin, path, to, deadline } = iface.parseTransaction(call)!.args
      return [
        getAction('Swap'),
        getToken(path[2][0], amountIn),
        getLabel('for at least'),
        getToken(path[2][path[2].length - 1], amountOutMin),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    },
    [iface.getFunction(
      'swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline)'
    )?.selector!]: (call: IrCall) => {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const { amountOut, amountInMax, path, to, deadline } = iface.parseTransaction(call)!.args
      return [
        getAction('Swap up to'),
        getToken(path[2][0], amountInMax),
        getLabel('for'),
        getToken(path[2][path[2].length - 1], amountOut),
        ...getRecipientText(accOp.accountAddr, to),
        getDeadline(deadline)
      ]
    }
  }

  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !matcher[call.data.slice(0, 10)]) return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return newCalls
}

export default traderJoeModule
