import { useCallback } from 'react'
import {
    Token,
    TokenWithIsHiddenFlag,
} from './types'

export default function useHiddenTokens({ useToasts, useStorage }: any): any {
  const [hiddenTokens, setHiddenTokens] = useStorage({ key: 'hiddenTokens', defaultValue: [] })
  const [hiddenCollectibles, setHiddenCollectibles] = useStorage({ key: 'hiddenCollectibles', defaultValue: [] })

  const { addToast } = useToasts()

  const onAddHiddenCollectible = useCallback(
    (hiddenCollectible: any, assetId: string) => {
      const { data } = hiddenCollectible.assets.find(({tokenId}: any) => tokenId === assetId)
      const updatedHiddenCollectibles = [
        ...hiddenCollectibles,
        {
          ...hiddenCollectible,
          assets: hiddenCollectible.assets.map((asset: any) => asset.tokenId === assetId && {...asset, isHidden: true})
        }
      ]

      setHiddenCollectibles(updatedHiddenCollectibles)
      addToast(`${data.name} collectible is hidden from your assets list!`)
    },
    [hiddenCollectibles, setHiddenCollectibles]
  )

  // In order to hide a specific asset from a collectible we need this kind of check,
  // because we render each asset for each collectible.
  // In that case if we have multiple assets in one collectible we will display them each separately
  const filterByHiddenCollectibles = useCallback((_collectibles: any[]) => {
    return _collectibles
    .map((t: any) => hiddenCollectibles?.find((ht: any) => t.address === ht.address && t.assets.map(({ tokenId }:any) => t.assets.find((asset: any) => tokenId === asset.tokenId))) || {...t, assets: t.assets.map((ta: any) => ({...ta, isHidden: false }))})
    .map((t: any) => ({...t, assets: t.assets.filter((asset: any) => !asset.isHidden)}))
    .filter((t: any) => t.assets && t.assets.length)
  }, [hiddenCollectibles])

  const onRemoveHiddenCollectible = useCallback(
    (address: string, assetId: string) => {
      const collectible = hiddenCollectibles?.find((t: any) => t.address === address)
      const asset = collectible.assets.find(({tokenId}: any) => tokenId === assetId)
      if (!asset) return addToast(`${assetId} is not present in your assets list.`)

      const updatedHiddenCollectibles = hiddenCollectibles?.filter((t: any) => t.address !== address && t.assets.filter(({ tokenId }:any) => tokenId !== assetId))

      setHiddenCollectibles(updatedHiddenCollectibles)
      addToast(`${asset.data.name} is shown to your assets list.`)
    },
    [hiddenCollectibles, setHiddenCollectibles]
  )

  const onAddHiddenToken = useCallback(
    (hiddenToken: TokenWithIsHiddenFlag) => {
      const { symbol } = hiddenToken
      const updatedHiddenTokens = [
        ...hiddenTokens,
        {
          ...hiddenToken,
          isHidden: true
        }
      ]

      setHiddenTokens(updatedHiddenTokens)
      addToast(`${symbol} token is hidden from your assets list!`)
    },
    [hiddenTokens, setHiddenTokens]
  )

  const filterByHiddenTokens = useCallback((_tokens: Token[]) => {
    return _tokens
      .map((t: Token) => {
        return hiddenTokens.find((ht: TokenWithIsHiddenFlag) => t.address === ht.address) || { ...t, isHidden: false }
      })
      .filter((t) => !t.isHidden)
  }, [hiddenTokens])

  const onRemoveHiddenToken = useCallback(
    (address: string) => {
      const token = hiddenTokens?.find((t: any) => t.address === address)
      if (!token) return addToast(`${address} is not present in your assets list.`)

      const updatedHiddenTokens = hiddenTokens?.filter((t: any) => t.address !== address)

      setHiddenTokens(updatedHiddenTokens)
      addToast(`${token.symbol} is shown to your assets list.`)
    },
    [hiddenTokens, setHiddenTokens]
  )

  return {
    onAddHiddenToken,
    onRemoveHiddenToken,
    setHiddenTokens,
    hiddenTokens,
    filterByHiddenTokens,
    onAddHiddenCollectible,
    onRemoveHiddenCollectible,
    filterByHiddenCollectibles,
    hiddenCollectibles
  }
}