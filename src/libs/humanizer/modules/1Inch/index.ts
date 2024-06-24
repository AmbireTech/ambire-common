import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { OneInch } from '../../const/abis/1Inch'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getLabel, getRecipientText, getToken } from '../../utils'

const oneInchAddressParser = (address: string) =>
  address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? ZeroAddress : address

const OneInchModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface(OneInch)
  const matcher = {
    [iface.getFunction('cancelOrder(uint256 makerTraits, bytes32 orderHash)')?.selector!]: (
      call: IrCall
    ) => {
      const { orderHash } = iface.parseTransaction(call)!.args
      return [
        getAction('Cancel order'),
        getLabel(`with order hash ${orderHash.slice(0, 5)}...${orderHash.slice(63, 66)}`)
      ]
    },
    [iface.getFunction(
      'unoswap2(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2)'
    )?.selector!]: (call: IrCall) => {
      const { token: tokenArg, amount } = iface.parseTransaction(call)!.args

      const token = `0x${BigInt(tokenArg).toString(16).padStart(40, '0')}`

      return [getAction('Swap'), getToken(oneInchAddressParser(token), amount)]
    },
    [iface.getFunction(
      'swap(address executor,tuple(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags) desc,bytes data)'
    )?.selector!]: (call: IrCall) => {
      const {
        desc: { srcToken, dstToken, dstReceiver, amount, minReturnAmount }
      } = iface.parseTransaction(call)!.args
      return [
        getAction('Swap'),
        getToken(oneInchAddressParser(srcToken), amount),
        getLabel('for'),
        getToken(oneInchAddressParser(dstToken), minReturnAmount),
        ...getRecipientText(accOp.accountAddr, dstReceiver)
      ]
    },
    [iface.getFunction('ethUnoswap(uint256, uint256)')?.selector!]: (call: IrCall) => {
      return [getAction('Swap'), getToken(oneInchAddressParser(ZeroAddress), call.value)]
    },
    [iface.getFunction('unoswap(uint256 token,uint256 amount,uint256 minReturn,uint256 dex)')
      ?.selector!]: (call: IrCall) => {
      const { token: tokenArg, amount } = iface.parseTransaction(call)!.args

      const token = `0x${BigInt(tokenArg).toString(16).padStart(40, '0')}`

      return [getAction('Swap'), getToken(oneInchAddressParser(token), amount)]
    },
    [iface.getFunction(
      'unoswapTo(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex)'
    )?.selector!]: (call: IrCall) => {
      const { token: tokenArg, amount } = iface.parseTransaction(call)!.args
      const token = `0x${BigInt(tokenArg).toString(16).padStart(40, '0')}`

      return [getAction('Swap'), getToken(oneInchAddressParser(token), amount)]
    },
    [iface.getFunction(
      'unoswap3(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3)'
    )?.selector!]: (call: IrCall) => {
      const { token: tokenArg, amount } = iface.parseTransaction(call)!.args
      const token = `0x${BigInt(tokenArg).toString(16).padStart(40, '0')}`

      return [getAction('Swap'), getToken(oneInchAddressParser(token), amount)]
    }
  }
  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !matcher[call.data.slice(0, 10)]) return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return [newCalls, []]
}

export default OneInchModule
