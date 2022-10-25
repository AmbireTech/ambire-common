// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'

// import ERC1155Abi from '../../constants/abis/ERC1155Abi'

// import ERC721Abi from '../../constants/abis/ERC721Abi'

// async function getCollectibleData(collectionAddress: string , tokenId: string, network: Network, walletAddr: string) : Promise<{ balance: string, metaURI: string } | null> {
//   const provider = getProvider(network)

//   try {
//     const token = new Contract(collectionAddress, ERC1155Abi, provider)
    
//     const balance = await token.balanceOf(walletAddr, tokenId)
//     const metaURI = await token.uri(tokenId)

//     //NOTE: this is for 1155 only, 721 is different
//     //NOTE: meta does not always have valid data

//     console.log({
//       balance,
//       metaURI
//     })

//     return {
//       balance,
//       metaURI
//     }
//   } catch (e){
//     console.log({e})
//     return null
//   }
// }

export default function useExtraTokens({ useStorage, useToasts, collectibles }: any) {
  const [extraCollectibles, setExtraCollectibles] = useStorage({ key: 'extraCollectibles', defaultValue: [] })

  const { addToast } = useToasts()

  const onAddExtraCollectible = useCallback(
    (extraCollectible) => {
      // 
      const { network, address, tokenId  } = extraCollectible
      //TODO: get nft data - collectionName, collectionImg, assetName, assetImg, balanceUSD - use relayer or custom fn (getCollectibleData)
  
      // TODO: checksummed address
      if (extraCollectibles.some(x =>  x.address === address && x.tokenId === tokenId))
        return addToast(`Collectible ${address} (${tokenId}) is already added to your wallet.`)
      if (
        Object.values(collectibles)
          .flat(1)
          .map(({ address }) => address)
          .includes(address)
      )
        return addToast(`${name} (${symbol}) is already handled by your wallet.`)
      if (tokens.map(({ address }) => address).includes(address))
        return addToast(`You already have ${name} (${symbol}) in your wallet.`)
  
      const updatedExtraCollectibles = [
        ...extraCollectibles,
        {
          ...extraToken,
          coingeckoId: null
        }
      ]
  
      setExtraCollectibles(updatedExtraCollectibles)
      addToast(`${name} (${symbol}) token added to your wallet!`)
    },
    [setExtraCollectibles, collectibles, extraCollectibles]
  )


  return {
    onAddExtraCollectible
  }
}