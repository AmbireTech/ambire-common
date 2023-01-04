// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'

export default function useExtraCollectibles({ useStorage, useToasts, collectibles }: any) {
  const [extraCollectibles, setExtraCollectibles] = useStorage({
    key: 'extraCollectibles',
    defaultValue: []
  })

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
      const { collectionAddress, tokenId } = extraCollectible

      if (extraCollectibles.some((x) => x.address === collectionAddress && x.tokenId === tokenId))
        return addToast(
          `Collectible ${collectionAddress} (${tokenId}) is already added to your wallet.`
        )

      const collectible = collectibles?.find(
        (t: any) => t.address.toLowerCase() === collectionAddress.toLowerCase()
      )
      const asset = collectible?.assets.find((item: any) => item.tokenId === tokenId)

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
    [addToast, setExtraCollectibles, collectibles, extraCollectibles]
  )

  const onRemoveExtraCollectible = useCallback(
    (address, tokenId) => {
      const collectible = extraCollectibles.find(
        (t) => t.address === address && t?.assets.find((item: any) => item.tokenId === tokenId)
      )

      if (!collectible) return addToast(`${address} is not present in your wallet.`)
      const updatedExtraCollectibles = extraCollectibles.filter(
        (coll) => coll.address === address && coll.assets.find((item) => item.tokenId !== tokenId)
      )

      setExtraCollectibles(updatedExtraCollectibles)
      addToast(`${collectible.address} (${collectible.tokenId}) was removed from your wallet.`)
    },
    [addToast, setExtraCollectibles, extraCollectibles]
  )

  return {
    extraCollectibles,
    getExtraCollectiblesAssets,
    onAddExtraCollectible,
    onRemoveExtraCollectible
  }
}
