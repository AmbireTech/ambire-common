import { ZeroAddress } from 'ethers'

import { TokenResult } from '../portfolio'

export function getFeeTokenForEstimate(feeTokens: TokenResult[]): TokenResult | null {
  if (!feeTokens.length) return null

  const erc20token = feeTokens.find(
    (feeToken) =>
      feeToken.address !== ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  if (erc20token) return erc20token

  const nativeToken = feeTokens.find(
    (feeToken) =>
      feeToken.address === ZeroAddress && !feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  if (nativeToken) return nativeToken

  const gasTankToken = feeTokens.find(
    (feeToken) => feeToken.flags.onGasTank && feeToken.amount > 0n
  )
  return gasTankToken ?? null
}
