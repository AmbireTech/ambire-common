import { useCallback } from 'react'

import { Collectible, Token, TokenWithIsHiddenFlag } from './types'

export default function useHiddenTokens({ useToasts, useStorage }: any): any {
  const [hiddenTokens, setHiddenTokens] = useStorage({ key: 'hiddenTokens', defaultValue: [] })
  const [hiddenCollectibles, setHiddenCollectibles] = useStorage({
    key: 'hiddenCollectibles',
    defaultValue: []
  })

  const { addToast } = useToasts()

  const onAddHiddenCollectible = useCallback(
    (
      hiddenCollectible: Collectible | Collectible[],
      assetId: Collectible['assets'][0]['tokenId'] | Collectible['assets'][0]['tokenId'][]
    ) => {
      if (Array.isArray(hiddenCollectible)) {
        setHiddenCollectibles((prevHiddenCollectibles: Collectible[]) => {
          // Handle the case where multiple collectibles and assetIds are passed
          const updatedHiddenCollectibles = hiddenCollectible.map((collectible, i: number) => {
            const currentAssetId = Array.isArray(assetId) ? assetId[i] : assetId
            return {
              ...collectible,
              assets: collectible.assets.map((asset) => {
                if (asset.tokenId === currentAssetId) {
                  return { ...asset, isHidden: true }
                }
                return asset
              })
            }
          })

          // Send a toast message for each added hidden collectible
          updatedHiddenCollectibles.forEach((_collectible, i: number) => {
            const currentAssetId = Array.isArray(assetId) ? assetId[i] : assetId
            const collectible = _collectible.assets.find(
              ({ tokenId }: any) => tokenId === currentAssetId
            )
            addToast(
              `${collectible && collectible.data.name} collectible is hidden from your assets list!`
            )
          })

          return [...prevHiddenCollectibles, ...updatedHiddenCollectibles]
        })
      } else {
        setHiddenCollectibles((prevHiddenCollectibles: any) => {
          const { data } = prevHiddenCollectibles.assets.find(
            ({ tokenId }: any) => tokenId === assetId
          )
          const updatedHiddenCollectible = {
            ...hiddenCollectible,
            assets: hiddenCollectible.assets.map(
              (asset: any) => asset.tokenId === assetId && { ...asset, isHidden: true }
            )
          }
          addToast(`${data.name} collectible is hidden from your assets list!`)
          return [...prevHiddenCollectibles, updatedHiddenCollectible]
        })
      }
    },
    [addToast, setHiddenCollectibles]
  )

  // In order to hide a specific asset from a collectible we need this kind of check,
  // because we render each asset for each collectible.
  // In that case if we have multiple assets in one collectible we will display them each separately
  const filterByHiddenCollectibles = useCallback(
    (_collectibles: any[]) => {
      return _collectibles
        .map(
          (t: any) =>
            hiddenCollectibles?.find(
              (ht: any) =>
                t.address === ht.address &&
                t.assets.map(({ tokenId }: any) =>
                  t.assets.find((asset: any) => tokenId === asset.tokenId)
                )
            ) || { ...t, assets: t.assets.map((ta: any) => ({ ...ta, isHidden: false })) }
        )
        .map((t: any) => ({ ...t, assets: t.assets.filter((asset: any) => !asset.isHidden) }))
        .filter((t: any) => t.assets && t.assets.length)
    },
    [hiddenCollectibles]
  )

  const onRemoveHiddenCollectible = useCallback(
    (address: string | string[], assetId: string | string[]) => {
      if (Array.isArray(address)) {
        setHiddenCollectibles((prevHiddenCollectibles: Collectible[]) => {
          const updatedHiddenCollectibles = prevHiddenCollectibles.filter(
            (t, i) =>
              !address.includes(t.address) &&
              t.assets.filter(({ tokenId }: any) => tokenId !== assetId[i])
          )

          // Identify removed tokens for toast messages
          const removedCollectibles = prevHiddenCollectibles.filter(
            (t, i) =>
              address.includes(t.address) &&
              t.assets.filter(({ tokenId }: any) => tokenId !== assetId[i])
          )

          // Send toast for each removed token
          removedCollectibles.forEach((token) => {
            addToast(`${token.symbol} is shown in your assets list.`)
          })

          // If some addresses weren't in the prevHiddenCollectibles, warn the user
          const notFoundAddresses = address.filter(
            (_address) => !prevHiddenCollectibles.some((t) => t.address === _address)
          )

          notFoundAddresses.forEach((_address) => {
            addToast(`${_address} is not present in your assets list.`)
          })

          return updatedHiddenCollectibles
        })
      } else {
        setHiddenCollectibles((prevHiddenCollectibles: any) => {
          const collectible = prevHiddenCollectibles?.find((t: any) => t.address === address)
          const asset = collectible.assets.find(({ tokenId }: any) => tokenId === assetId)
          if (!asset) return addToast(`${assetId} is not present in your assets list.`)

          addToast(`${asset.data.name} is shown to your assets list.`)
          return prevHiddenCollectibles.filter(
            (t: any) =>
              t.address !== address && t.assets.filter(({ tokenId }: any) => tokenId !== assetId)
          )
        })
      }
    },
    [addToast, setHiddenCollectibles]
  )

  const onAddHiddenToken = useCallback(
    (hiddenToken: TokenWithIsHiddenFlag | TokenWithIsHiddenFlag[]) => {
      if (Array.isArray(hiddenToken)) {
        setHiddenTokens((prevHiddenTokens: TokenWithIsHiddenFlag[]) => [
          // Make sure there are no duplicates
          ...prevHiddenTokens.filter(
            (t: TokenWithIsHiddenFlag) => !hiddenToken.some((ht) => ht.address === t.address)
          ),
          ...hiddenToken.map((t) => ({ ...t, isHidden: true }))
        ])
        hiddenToken.forEach((token: TokenWithIsHiddenFlag) => {
          const { symbol } = token
          addToast(`${symbol} token is hidden from your assets list!`)
        })
      } else {
        // If hiddenToken is a single object
        const { symbol } = hiddenToken
        setHiddenTokens((prevHiddenTokens: TokenWithIsHiddenFlag[]) => [
          ...prevHiddenTokens.filter((t) => t.address !== hiddenToken.address),
          { ...hiddenToken, isHidden: true }
        ])
        addToast(`${symbol} token is hidden from your assets list!`)
      }
    },
    [addToast, setHiddenTokens]
  )

  const filterByHiddenTokens = useCallback(
    (_tokens: Token[]) => {
      return _tokens
        .map((t: Token) => {
          return (
            hiddenTokens.find((ht: TokenWithIsHiddenFlag) => t.address === ht.address) || {
              ...t,
              isHidden: false
            }
          )
        })
        .filter((t) => !t.isHidden)
    },
    [hiddenTokens]
  )

  const onRemoveHiddenToken = useCallback(
    (address: string | string[]) => {
      // Check if hiddenTokens is an array
      if (Array.isArray(address)) {
        setHiddenTokens((prevTokens: Token[]) => {
          const updatedHiddenTokens = prevTokens.filter((t) => !address.includes(t.address))

          // Identify removed tokens for toast messages
          const removedTokens = prevTokens.filter((t) => address.includes(t.address))

          // Send toast for each removed token
          removedTokens.forEach((token) => {
            addToast(`${token.symbol} is shown in your assets list.`)
          })

          // If some addresses weren't in the prevTokens, warn the user
          const notFoundAddresses = address.filter(
            (_address) => !prevTokens.some((t) => t.address === _address)
          )
          notFoundAddresses.forEach((_address) => {
            addToast(`${_address} is not present in your assets list.`)
          })

          return updatedHiddenTokens
        })
      } else {
        setHiddenTokens((prevHiddenTokens: TokenWithIsHiddenFlag[]) => {
          const token = prevHiddenTokens.find((t) => t.address === address)
          if (token) {
            addToast(`${token.symbol} is shown to your assets list.`)
            return prevHiddenTokens.filter((t: any) => t.address !== address)
          }

          addToast(`${address} is not present in your assets list.`)
          return prevHiddenTokens
        })
      }
    },
    [addToast, setHiddenTokens]
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
