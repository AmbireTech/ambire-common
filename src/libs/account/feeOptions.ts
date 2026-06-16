import { Interface, ZeroAddress } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import { AccountOp } from '../accountOp/accountOp'
import { FeePaymentOption } from '../estimate/interfaces'
import { getAmountAfterFeeReserve } from '../transfer/amount'

const ERC20Interface = new Interface(IERC20.abi)

const isTransferredTokenFeeOption = (feeOption: FeePaymentOption, op: AccountOp): boolean => {
  if (!op.meta?.allowTransferFeeTokenSelfReserve) return false

  if (
    feeOption.token.flags.onGasTank ||
    feeOption.paidBy.toLowerCase() !== op.accountAddr.toLowerCase()
  )
    return false

  if (feeOption.token.address === ZeroAddress) {
    return op.calls.some((call) => call.value > 0n && call.data === '0x')
  }

  return op.calls.some((call) => {
    if (!call.to || call.to.toLowerCase() !== feeOption.token.address.toLowerCase()) return false

    try {
      ERC20Interface.decodeFunctionData('transfer', call.data)
      return true
    } catch {
      return false
    }
  })
}

const canFeeOptionCoverAmount = (
  feeOption: FeePaymentOption,
  op: AccountOp,
  amount: bigint
): boolean => {
  if (feeOption.availableAmount >= amount) return true
  if (!isTransferredTokenFeeOption(feeOption, op)) return false

  return getAmountAfterFeeReserve(feeOption.token.amount, amount) > 0n
}

export { canFeeOptionCoverAmount, isTransferredTokenFeeOption }
