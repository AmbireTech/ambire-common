import { ZeroAddress } from 'ethers'

import { TokenResult } from '../portfolio'

export function getFeeTokenForEstimate(feeTokens: TokenResult[]): TokenResult | null {
  if (!feeTokens.length) return null

  // we prioritize the gasTank as on L2 networks, the gasTank commitment
  // actually results in bigger preVerificationGas (ERC-4337). Low
  // preVerificationGas will cause the paymaster to refuse the userOp
  const gasTankToken = feeTokens.find(
    (feeToken) => feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  if (gasTankToken) return gasTankToken

  const erc20token = feeTokens.find(
    (feeToken) =>
      feeToken.address !== ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  if (erc20token) return erc20token

  const nativeToken = feeTokens.find(
    (feeToken) =>
      feeToken.address === ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  return nativeToken ?? null
}
