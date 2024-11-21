import { ZeroAddress } from 'ethers'

import { Network } from '../../interfaces/network'
import { TokenResult } from '../portfolio'

export function getFeeTokenForEstimate(
  feeTokens: TokenResult[],
  network: Network
): TokenResult | null {
  if (!feeTokens.length) return null

  const gasTankToken = feeTokens.find(
    (feeToken) => feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  const erc20token = feeTokens.find(
    (feeToken) =>
      feeToken.address !== ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  const nativeToken = feeTokens.find(
    (feeToken) =>
      feeToken.address === ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n
  )

  // for optimistic L2s, prioritize the gas tank token as a fee payment
  // option as its callData costs more than the actual transfer of tokens
  if (network.isOptimistic) {
    if (gasTankToken) return gasTankToken
    if (erc20token) return erc20token
    return nativeToken ?? null
  }

  // for L1s, prioritize erc20 transfer as it's the most expensive
  if (erc20token) return erc20token
  if (nativeToken) return nativeToken
  return gasTankToken ?? null
}
