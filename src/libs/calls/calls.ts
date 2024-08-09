import { AbiCoder, Interface, ZeroAddress } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { Call } from '../accountOp/types'
import { TokenResult } from '../portfolio'

export function getFeeCall(feeToken: TokenResult, amountToSend: bigint): Call {
  if (feeToken.flags.onGasTank) {
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
    data: ERC20Interface.encodeFunctionData('approve', [DEPLOYLESS_SIMULATION_FROM, amountToSend])
  }
}
