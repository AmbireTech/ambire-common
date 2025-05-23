import { AbiCoder, Interface, ZeroAddress } from 'ethers'

import ERC20 from '../../../contracts/compiled/IERC20.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import { Network } from '../../interfaces/network'
import { Call } from '../accountOp/types'
import { TokenResult } from '../portfolio'

const abiCoder = new AbiCoder()
const ERC20Interface = new Interface(ERC20.abi)

export function getFeeCall(feeToken: TokenResult): Call {
  // set a bigger number for gas tank / approvals so on
  // L2s it could calculate the preVerificationGas better
  const gasTankOrApproveAmount = 500n * BigInt(feeToken.decimals)

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
  chainId: bigint
} {
  if (to === FEE_COLLECTOR) {
    if (data === '0x') {
      return {
        address: ZeroAddress,
        amount: value,
        isGasTank: false,
        chainId: network.chainId
      }
    }

    const [, amount, symbol] = abiCoder.decode(['string', 'uint256', 'string'], data)

    // Prioritize Ethereum tokens
    const ethereumToken = gasTankFeeTokens.find(
      ({ symbol: tSymbol, chainId: tChainId }) =>
        tSymbol.toLowerCase() === symbol.toLowerCase() && tChainId === 1n
    )
    // Fallback to network tokens
    const networkToken =
      network.chainId !== 1n
        ? gasTankFeeTokens.find(
            ({ symbol: tSymbol, chainId: tChainId }) =>
              tSymbol.toLowerCase() === symbol.toLowerCase() && tChainId === network.chainId
          )
        : null
    // Fallback to any network token. Example: user paid the fee on Base
    // with Wrapped Matic (neither Ethereum nor Base token)
    const anyNetworkToken = gasTankFeeTokens.find(
      ({ symbol: tSymbol }) => tSymbol.toLowerCase() === symbol.toLowerCase()
    )

    // This is done for backwards compatibility with the old gas tank. A known flaw
    // is that it may prioritize the wrong token. Example: a user had paid the fee with
    // USDT on BSC, but we prioritize the USDT on Ethereum. 18 vs 6 decimals.
    // There is no way to fix this as the call data doesn't contain the decimals nor
    // the network of the token.
    const { address, chainId } = ethereumToken || networkToken || anyNetworkToken || {}

    if (!address)
      throw new Error(
        `Unable to find gas tank fee token for symbol ${symbol} and network ${chainId}`
      )

    return {
      amount,
      address,
      isGasTank: true,
      chainId: chainId!
    }
  }

  const [, amount] = ERC20Interface.decodeFunctionData('transfer', data)
  return {
    amount,
    address: to,
    isGasTank: false,
    chainId: network.chainId
  }
}
