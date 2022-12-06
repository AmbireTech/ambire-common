// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'
import { Contract } from 'ethers'

import ERC1155Abi from 'ambire-common/src/constants/abis/ERC1155Abi'
// import ERC721Abi from '../../constants/abis/ERC721Abi'
import { getProvider } from '../../services/provider'


export default function useExtraCollectibles({ useStorage, useToasts, collectibles }: any) {
  const [extraCollectibles, setExtraCollectibles] = useStorage({ key: 'extraCollectibles', defaultValue: [] })

  const { addToast } = useToasts()

  const getExtraCollectiblesAssets = useCallback(
    (account: string, network: NetworkId) =>
      extraCollectibles
        .filter((extra: Token) => extra.account === account && extra.network === network)
        .map((extraCollectible: Token) => ({
          ...extraCollectible,
          type: 'nft',
          price: 0,
          balanceUSD: 0,
          isExtraCollectible: true
        })),
    [extraCollectibles]
  )

  const onAddExtraCollectible = useCallback(
    (extraCollectible) => {
      // 
      const { collectionAddress, tokenId } = extraCollectible
      //TODO: get nft data - collectionName, collectionImg, assetName, assetImg, balanceUSD - use relayer or custom fn (getCollectibleData)
      // const { balance, data } = getCollectibleData(collectionAddress, tokenId, network, address)

      if (extraCollectibles.some(x =>  x.address === collectionAddress && x.tokenId === tokenId))
        return addToast(`Collectible ${collectionAddress} (${tokenId}) is already added to your wallet.`)

      const collectible = collectibles?.find((t: any) => t.address === collectionAddress)
      const asset = collectible.assets.find((asset: any) => asset.tokenId === tokenId)
      debugger
      if (collectible && asset) {
        return addToast(`${collectionAddress} (${tokenId}) is already handled by your wallet.`)
      }

      const updatedExtraCollectibles = [
        ...extraCollectibles,
        {
          ...extraCollectible,
          coingeckoId: null
        }
      ]

      setExtraCollectibles(updatedExtraCollectibles)
      addToast(`${collectionAddress} (${tokenId}) is added to your wallet!`)
    },
    [setExtraCollectibles, collectibles, extraCollectibles]
  )
  

  const onRemoveExtraCollectible = useCallback(
    (address, tokenId) => {
      const collectible = extraCollectibles.find((t) => t.address === address)
      if (!collectible) return addToast(`${address} is not present in your wallet.`)

      const updatedExtraCollectibles = extraCollectibles.filter((t) => t.address !== address)

      setExtraCollectibles(updatedExtraCollectibles)
      addToast(`${token.name} (${token.symbol}) was removed from your wallet.`)
    },
    [extraCollectibles, setExtraCollectibles]
  )

  return {
    extraCollectibles,
    getExtraCollectiblesAssets,
    onAddExtraCollectible,
    onRemoveExtraCollectible,
  }
}