import { AbiCoder, Interface, ZeroAddress } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { Network } from '../../interfaces/network'
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
  network: Network
): {
  address: string
  amount: bigint
  isGasTank: boolean
  network: Network
} {
  if (to === FEE_COLLECTOR) {
    if (data === '0x') {
      return {
        address: ZeroAddress,
        amount: value,
        isGasTank: false,
        network
      }
    }

    const [, amount] = abiCoder.decode(['string', 'uint256', 'string'], data)

    // USDC is the only token in the gas tank.
    // It's hard-coded this way as the gas tank can be used
    // on multiple networks and some of them have a different
    // amount of decimals. (e.g. Binance Smart Chain)
    return {
      amount,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      isGasTank: true,
      network: networks.find(({ chainId }) => chainId === 1n)!
    }
  }

  const [, amount] = ERC20Interface.decodeFunctionData('transfer', data)
  return {
    amount,
    address: to,
    isGasTank: false,
    network
  }
}
