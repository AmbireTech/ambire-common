// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'

import { ethers } from 'ethers'
import supportedProtocols from 'ambire-common/src/constants/supportedProtocols'
import networks from 'ambire-common/src/constants/networks'
import { roundFloatingNumber } from 'ambire-common/src/services/formatter'
import { removeDuplicatedAssets } from 'ambire-common/src/hooks/usePortfolio/usePortfolioFetch/useBalanceOracleFetch'


export default function useVelcroFetch({
    currentAccount,
    currentNetwork,
    setAssetsByAccount,
    addToast,
    getBalances,
    filterByHiddenTokens,
    updateCoingeckoAndSupplementData,
    hiddenTokens,
    extraTokensAssets,
    eligibleRequests,
    fetchingAssets,
    setFetchingAssets,
    оtherNetworksFetching,
    setOtherNetworksFetching
}) {
    const formatTokensResponse = (tokens, assets, network) => {
      return removeDuplicatedAssets([
        ...tokens.map((token: any) => {
        const prevToken = assets?.tokens?.length && assets?.tokens.find(t => t.address === token.address)
        let updatedData = {}
        if (!prevToken) return updatedData = { ...token }
        const { balance, balanceUSD, balanceUpdate, price, priceUpdate, ...newData } = token
        updatedData = {
          ...prevToken,
          ...newData,
        }

        if (!prevToken?.balanceOracleUpdate || token.balanceUpdate > prevToken?.balanceOracleUpdate || token.balanceUpdate > prevToken?.balanceUpdate) {
          // update balance 
          updatedData = {
            ...updatedData,
            balance,
            balanceUpdate,
          }
        }

        if (!prevToken?.priceUpdate || (token?.priceUpdate > prevToken?.priceUpdate) && ((token?.priceUpdate - prevToken?.priceUpdate) >= 5*60*1000)) {
          // update price
          updatedData = {
            ...updatedData,
            price,
            priceUpdate,
          }
        }
        return updatedData
      }).map((token: any) => ({
          ...token,
          // balanceOracle fixes the number to the 10 decimal places, so here we should also fix it
          balance: token?.balance ? Number(token?.balance?.toFixed(10)) : Number(ethers.utils.formatUnits(token?.balanceRaw, token?.decimals)).toFixed(10),
          // Update balanceUSD in case its old but price is new
          balanceUSD: roundFloatingNumber(Number(parseFloat(token?.balance * token?.price || 0).toFixed(2))),
          price: token?.price || null,
          network: network
        }))
        .filter((token: any) => !!token.name && !!token.symbol),
        ...extraTokensAssets.filter(t => t.network === network)
      ])
    }
    const fetchOtherNetworksBalances = async (account, assets) => {
        if (!оtherNetworksFetching) {
          setOtherNetworksFetching(true)
        }
        const networksToFetch = supportedProtocols.filter(({ network }) => network !== currentNetwork).filter(({ network }) => !networks.find(({id}) => id === network)?.relayerlessOnly)
        try {
          Promise.all(
            networksToFetch.map(async ({ network, balancesProvider }) => { 
              try {
                  const response = await getBalances(network, account, balancesProvider)
                  if (!response) return null
                  const currentAssetsKey = Object.keys(assets).length && Object.keys(assets).filter(key => key.includes(account) && key.includes(network))
                  const prevCacheTime = currentAssetsKey && assets[currentAssetsKey]?.cacheTime || null
                  let { tokens = [], nfts, cache, cacheTime } = response.data

                  const shouldSkipUpdate = cache && (new Date(cacheTime) < new Date(prevCacheTime))
                  cache = shouldSkipUpdate || false
            
                  let formattedTokens = formatTokensResponse(tokens, assets[currentAssetsKey], network)
                  formattedTokens = filterByHiddenTokens(formattedTokens)
                  setAssetsByAccount(prev => ({
                      ...prev,
                      [`${account}-${network}`]: {
                          ...prev[`${account}-${network}`],
                          cache: cache || false,
                          cacheTime: cacheTime || prevCacheTime,
                          tokens: formattedTokens,
                          collectibles: nfts,
                          loading: false,
                          network: network
                      }
                  }))
                  return true
            } catch (e) {          
                setAssetsByAccount(prev => ({
                  ...prev,
                  [`${account}-${network}`]: {
                    ...prev[`${account}-${network}`],
                    loading: false
                  }
              }))
              return false
            }
        })).then(() => {
          setOtherNetworksFetching(false)
        })
      }
        catch (e) {
          setOtherNetworksFetching(false)
          addToast(e.message, { error: true })
        }
    }

    // Full update of tokens
    const fetchTokens = useCallback(
        // eslint-disable-next-line default-param-last
        async (
          account: string,
          currentNetwork: NetworkId,
          showLoadingState = false,
          assets = []
        ) => {
          // Prevent race conditions and multiple fetchings
          if (currentAccount.current !== account || fetchingAssets[`${account}-${currentNetwork}`]?.velcro) return

          setFetchingAssets(prev => ({
            ...prev,
            [`${account}-${currentNetwork}`]: { 
              ...prev[`${account}-${currentNetwork}`],
              velcro: true,
            }
          }))
        
          if (showLoadingState || !assets?.tokens?.length) {
            setAssetsByAccount(prev => ({
              ...prev,
              [`${account}-${currentNetwork}`]: {
                ...prev[`${account}-${currentNetwork}`],
                loading: true,
              }
            }))
          }
    
          const network = supportedProtocols.find(({ network }) => network === currentNetwork)
          
          try {
            const quickResponse = !assets?.tokens?.length
            const response = await getBalances(currentNetwork, account, network.balancesProvider, quickResponse)
            if (!response) return null

            let { cache, cacheTime, tokens, nfts, partial, provider, error } = response.data

            tokens = filterByHiddenTokens(tokens)
            const prevCacheTime = assets?.cacheTime
            // We should skip the tokens update for the current network,
            // in the case Velcro returns a cached data, which is more outdated than the already fetched data or we have partial data.
            const shouldSkipUpdate =
              cache &&
              (new Date(cacheTime) < new Date(prevCacheTime)) || partial
            
            if (cacheTime === prevCacheTime) {
              setFetchingAssets(prev => ({
                ...prev,
                [`${account}-${currentNetwork}`]: { 
                  ...prev[`${account}-${currentNetwork}`],
                  velcro: false,
                }
              }))
              setAssetsByAccount(prev => ({
                ...prev,
                [`${account}-${currentNetwork}`]: {
                  ...prev[`${account}-${currentNetwork}`],
                  tokens: removeDuplicatedAssets([...(assets?.tokens ? assets?.tokens : []), ...(extraTokensAssets?.length ? extraTokensAssets : [])]),
                }
              }))
            }

            cache = shouldSkipUpdate || false
            // Tokens with balanceUpdate newer than balanceOracles update
            const tokensToUpdateBalance = tokens.filter(newToken => assets?.tokens?.length ? assets?.tokens.find(t => t.address === newToken.address && newToken.balanceUpdate > t?.balanceOracleUpdate) : newToken)
            
            let formattedTokens = []

            // velcro provider is balanceOracle and tokens may not be full
            // repopulate with current tokens and pass them to balanceOracle
            if (provider === 'balanceOracle' || partial) {
              formattedTokens = removeDuplicatedAssets([
                ...assets?.tokens || [],
                ...tokens,
              ])
            }
            
            // In case we have cached data from velcro - call balance oracle
            if (!quickResponse && shouldSkipUpdate || !tokensToUpdateBalance.length) {
              formattedTokens = removeDuplicatedAssets([...(formattedTokens?.length ? formattedTokens : assets?.tokens ? assets?.tokens : []), ...(extraTokensAssets?.length ? extraTokensAssets : [])])
              setFetchingAssets(prev => ({
                ...prev,
                [`${account}-${currentNetwork}`]: { 
                  ...prev[`${account}-${currentNetwork}`],
                  velcro: false,
                }
              }))
              updateCoingeckoAndSupplementData(
                { ...response.data,
                collectibles: nfts,
                cache: cache || false,
                cacheTime: cacheTime || prevCacheTime,
                tokens: formattedTokens
                },
                5
              )
              return 
            }
            formattedTokens = formatTokensResponse(tokens, assets, network?.network)
            // Set the new data from velcro if we don't have any tokens yet
            // this can happen on first data update and we need to set our state
            // so the user doesnt wait too long seeing the loading state
            if (!assets?.tokens?.length) {
              setAssetsByAccount(prev => ({
                ...prev,
                [`${account}-${currentNetwork}`]: {
                  ...prev[`${account}-${currentNetwork}`],
                  tokens: formattedTokens,
                  collectibles: nfts,
                  cache: cache || false,
                  cacheTime: cacheTime || prevCacheTime,
                  loading: false,
                  network: currentNetwork,
                }
              }))
            } else {
              // Otherwise wait for balance Oracle to set our tokens in state,
              // but still there is a need to update the loading state and other data.
              setAssetsByAccount(prev => ({
                ...prev,
                [`${account}-${currentNetwork}`]: {
                  ...prev[`${account}-${currentNetwork}`],
                  collectibles: nfts,
                  cache: cache || false,
                  cacheTime: cacheTime || prevCacheTime,
                  loading: false,
                  network: currentNetwork
                }
              }))
            }
            setFetchingAssets(prev => ({
              ...prev,
              [`${account}-${currentNetwork}`]: { 
                ...prev[`${account}-${currentNetwork}`],
                velcro: false,
              }
            }))
            updateCoingeckoAndSupplementData({ ...response.data,
              collectibles: nfts,
              cache: cache || false,
              cacheTime: cacheTime || prevCacheTime, tokens: formattedTokens }, 5)
            
            // Show error in case we have some
            // if (error) addToast(error, { error: true })
            
          } catch (e) {
            console.error('Balances API error', e)
            addToast(e.message, { error: true })

            setFetchingAssets(prev => ({
              ...prev,
              [`${account}-${currentNetwork}`]: { 
                ...prev[`${account}-${currentNetwork}`],
                velcro: false,
              }
            }))

            setAssetsByAccount(prev => ({
                ...prev,
                [`${account}-${network}`]: {
                  ...prev[`${account}-${network}`],
                  error: e,
                  loading: false,
                }
            }))
          }
          
        },
        [hiddenTokens, extraTokensAssets, addToast, eligibleRequests]
    )
    return {
        fetchOtherNetworksBalances,
        fetchTokens
    }
}