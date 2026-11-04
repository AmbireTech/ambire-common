import { isAddress } from 'ethers'

import { TransferNft } from '../../interfaces/transfer'
import { View } from '../../interfaces/ui'

/**
 * Reads the NFT to send from the transfer route search params
 * (`?address=<collection>&chainId=<chainId>&tokenId=<tokenId>`).
 * Returns `null` if the params don't describe a valid NFT.
 */
export const getNftParamsFromSearchParams = (
  searchParams: View['searchParams']
): Pick<TransferNft, 'address' | 'chainId' | 'tokenId'> | null => {
  if (!searchParams?.address || !searchParams.chainId || searchParams.tokenId === undefined)
    return null

  const address = String(searchParams.address)
  const rawTokenId = String(searchParams.tokenId).trim()
  const rawChainId = String(searchParams.chainId).trim()
  // BigInt('') is 0n, so an empty value must be rejected explicitly
  if (!isAddress(address) || !rawTokenId || !rawChainId) return null

  try {
    const tokenId = BigInt(rawTokenId)
    const chainId = BigInt(rawChainId)
    if (tokenId < 0n || chainId <= 0n) return null

    return { address, chainId, tokenId }
  } catch {
    // Not a number - the params were not produced by the app
    return null
  }
}
