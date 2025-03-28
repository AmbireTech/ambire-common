import { AbiCoder, Interface, ZeroAddress } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { Call } from '../accountOp/types'
import { TokenResult } from '../portfolio'

const abiCoder = new AbiCoder()
const ERC20Interface = new Interface(ERC20.abi)

export function getFeeCall(feeToken: TokenResult): Call {
  // set a bigger number for gas tank / approvals so on
  // L2s it could calculate the preVerificationGas better
  const gasTankOrApproveAmount = 500000000n * BigInt(feeToken.decimals)

  if (feeToken.flags.onGasTank) {
    return {
      to: FEE_COLLECTOR,
      value: 0n,
      data: abiCoder.encode(
        ['string', 'uint256', 'string'],
        ['gasTank', gasTankOrApproveAmount, feeToken.symbol]
      )
    }
  }

  if (feeToken.address === ZeroAddress) {
    // native payment
    return {
      to: FEE_COLLECTOR,
      value: 1n,
      data: '0x'
    }
  }

  // token payment
  return {
    to: feeToken.address,
    value: 0n,
    data: ERC20Interface.encodeFunctionData('approve', [
      DEPLOYLESS_SIMULATION_FROM,
      gasTankOrApproveAmount
    ])
  }
}

export function decodeFeeCall(
  { to, value, data }: Call,
  chainId: bigint
): {
  address: string
  amount: bigint
  isGasTank: boolean
} {
  if (to === FEE_COLLECTOR) {
    if (data === '0x') {
      return {
        address: ZeroAddress,
        amount: value,
        isGasTank: false
      }
    }

    const [, amount, symbol] = abiCoder.decode(['string', 'uint256', 'string'], data)
    const { address } =
      gasTankFeeTokens.find(
        ({ symbol: tSymbol, chainId: tChainId }) =>
          tSymbol.toLowerCase() === symbol.toLowerCase() && tChainId === chainId
      ) || {}

    if (!address)
      throw new Error(
        `Unable to find gas tank fee token for symbol ${symbol} and network with id ${chainId}`
      )

    return {
      amount,
      address,
      isGasTank: true
    }
  }

  const [, amount] = ERC20Interface.decodeFunctionData('transfer', data)
  return {
    amount,
    address: to,
    isGasTank: false
  }
}
