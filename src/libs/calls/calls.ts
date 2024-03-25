import { AbiCoder, Interface, ZeroAddress } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { FeeToken } from '../estimate/interfaces'

export function getFeeCall(feeToken: FeeToken, amountToSend: bigint) {
  if (feeToken.isGasTank) {
    const abiCoder = new AbiCoder()
    return {
      to: FEE_COLLECTOR,
      value: 0n,
      data: abiCoder.encode(
        ['string', 'uint256', 'string'],
        ['gasTank', amountToSend, feeToken.symbol]
      )
    }
  }

  if (feeToken.address === ZeroAddress) {
    // native payment
    return {
      to: FEE_COLLECTOR,
      value: amountToSend,
      data: '0x'
    }
  }

  // token payment
  const ERC20Interface = new Interface(ERC20.abi)
  return {
    to: feeToken.address,
    value: 0n,
    data: ERC20Interface.encodeFunctionData('transfer', [FEE_COLLECTOR, amountToSend])
  }
}
