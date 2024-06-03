import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { getAction, getLabel, getOnBehalfOf, getToken } from '../../utils'

const AaveWethGatewayV2 = [
  'function authorizeLendingPool(address lendingPool)',
  'function borrowETH(address lendingPool, uint256 amount, uint256 interesRateMode, uint16 referralCode)',
  'function depositETH(address lendingPool, address onBehalfOf, uint16 referralCode) payable',
  'function emergencyEtherTransfer(address to, uint256 amount)',
  'function emergencyTokenTransfer(address token, address to, uint256 amount)',
  'function getWETHAddress() view returns (address)',
  'function owner() view returns (address)',
  'function renounceOwnership()',
  'function repayETH(address lendingPool, uint256 amount, uint256 rateMode, address onBehalfOf) payable',
  'function transferOwnership(address newOwner)',
  'function withdrawETH(address lendingPool, uint256 amount, address to)'
]

export const aaveWethGatewayV2 = (): { [key: string]: Function } => {
  const iface = new Interface(AaveWethGatewayV2)
  return {
    [iface.getFunction('depositETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, onBehalfOf] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Deposit'),
        getToken(ZeroAddress, call.value),
        getLabel('to Aave lending pool'),
        ...getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('withdrawETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount, to] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Withdraw'),
        getToken(ZeroAddress, amount),
        getLabel('from Aave lending pool'),
        ...getOnBehalfOf(to, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('repayETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, , , /* lendingPool */ /* amount */ /* rateMode */ onBehalfOf] =
        iface.parseTransaction(call)?.args || []
      return [
        getAction('Repay'),
        getToken(ZeroAddress, call.value),
        getLabel('to Aave lending pool'),
        getOnBehalfOf(onBehalfOf, accountOp.accountAddr)
      ]
    },
    [iface.getFunction('borrowETH')?.selector!]: (accountOp: AccountOp, call: IrCall) => {
      const [, /* lendingPool */ amount] = iface.parseTransaction(call)?.args || []
      return [
        getAction('Borrow '),
        getToken(ZeroAddress, amount),
        getLabel('from Aave lending pool')
      ]
    }
  }
}
