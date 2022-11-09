// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'

import supportedProtocols from 'ambire-common/src/constants/supportedProtocols'
import networks from 'ambire-common/src/constants/networks'
import { roundFloatingNumber } from 'ambire-common/src/services/formatter'

export default function useVelcroFetch({
    account,
    currentAccount,
    currentNetwork,
    setAssetsByAccount,
    addToast,
    getBalances,
    filterByHiddenTokens,
    updateCoingeckoAndSupplementData,
    fetchAndSetSupplementTokenData,
    hiddenTokens,
    extraTokensAssets,
    eligibleRequests,
    setItems
}) {
    const fetchOtherNetworksBalances = async (account, assets) => {
        const networksToFetch = supportedProtocols.filter(({ network }) => network !== currentNetwork).filter(({ network }) => !networks.find(({id}) => id === network)?.relayerlessOnly)
        try {
          Promise.all(
            networksToFetch.map(async ({ network, balancesProvider }) => {
              setAssetsByAccount(prev => ({
                ...prev,
                [`${account}-${network}`]: {
                  ...prev[`${account}-${network}`],
                  loading: true
                }
              }))
              
              try {
                  const response = await getBalances(network, account, balancesProvider)
                  if (!response) return null
                  const currentAssetsKey = Object.keys(assets).length && Object.keys(assets).filter(key => key.includes(account) && key.includes(network))

                  const prevCacheTime = currentAssetsKey && assets[currentAssetsKey]?.cacheTime || null
                  let { tokens = [], nfts, cache, cacheTime } = response.data
                  
                  const shouldSkipUpdate = cache && (new Date(cacheTime) < new Date(prevCacheTime))
                  cache = shouldSkipUpdate || false

                  let formattedTokens = [
                      ...tokens.map((token: any) => ({
                          ...token,
                        // balanceOracle fixes the number to the 10 decimal places, so here we should also fix it
                        balance: Number(token.balance.toFixed(10)),
                        // balanceOracle rounds to the second decimal places, so here we should also round it
                        balanceUSD: roundFloatingNumber(token.balanceUSD),
                        price: token.price || null,
                        network: network
                    }))
                    .filter((token: any) => !!token.name && !!token.symbol),
                ]
                
                formattedTokens = filterByHiddenTokens(formattedTokens)
                // Set Items in IndexedDB
                setItems({ assetsByAccount: {
                  ...response.data,
                  cache: cache || false,
                  cacheTime: cacheTime || prevCacheTime,
                  tokens: formattedTokens,
                  collectibles: nfts,
                  loading: false,
                  network: network,
                }, key: `${account}-${network}`})

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
                addToast(e.message, { error: true })
          
                setAssetsByAccount(prev => ({
                  ...prev,
                  [`${account}-${network}`]: {
                    ...prev[`${account}-${network}`],
                    loading: false
                  }
              }))
              return false
            }
        }))}
        catch (e) {
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
          if (currentAccount.current !== account || assets?.fetchingVelcro) return
        
          if (showLoadingState || !assets?.tokens?.length) {
            setAssetsByAccount(prev => ({
              ...prev,
              [`${account}-${currentNetwork}`]: {
                ...prev[`${account}-${currentNetwork}`],
                loading: true,
                fetchingVelcro: true
              }
            }))
          } else {
            setAssetsByAccount(prev => ({
              ...prev,
              [`${account}-${currentNetwork}`]: {
                ...prev[`${account}-${currentNetwork}`],
                fetchingVelcro: true,
              }
            }))
          }
    
          const network = supportedProtocols.find(({ network }) => network === currentNetwork)
          
          try {
            const quickResponse = !assets?.tokens?.length
            const response = await getBalances(currentNetwork, account, network.balancesProvider, quickResponse)
            if (!response) return null

            let { cache, cacheTime, tokens, nfts, partial, error, provider } = response.data
    
            tokens = filterByHiddenTokens(tokens)
            const prevCacheTime = assets?.cacheTime
            // provider = "balanceOracle"
            // We should skip the tokens update for the current network,
            // in the case Velcro returns a cached data, which is more outdated than the already fetched data.
            const shouldSkipUpdate =
              cache &&
              (new Date(cacheTime) < new Date(prevCacheTime)) || partial
    
            cache = shouldSkipUpdate || false

            // Tokens with balanceUpdate newer than balanceOracles update
            const tokensToUpdateBalance = tokens.filter(newToken => assets?.tokens?.length ? assets?.tokens.find(t => t.address === newToken.address && newToken.balanceUpdate > t?.balanceOracleUpdate) : newToken)
            
            let formattedTokens = !tokensToUpdateBalance?.length ? assets?.tokens && assets.tokens.length && [...assets?.tokens] : [...tokens]
            
            // velcro provider is balanceOracle and tokens may not be full
            // repopulate with current tokens and pass them to balanceOracle
            if (provider === 'balanceOracle') {
              formattedTokens = [
                ...assets?.tokens || [],
                ...formattedTokens,
              ]
            }
    
            // In case we have cached data from velcro - call balance oracle
            if (shouldSkipUpdate || !tokensToUpdateBalance.length) {
              // Update only balance from balance oracle
              updateCoingeckoAndSupplementData({ ...response.data, ...response.data,
                collectibles: nfts,
                cache: cache || false,
                cacheTime: cacheTime || prevCacheTime, tokens: formattedTokens })
              return 
            }

            formattedTokens = [
              ...formattedTokens
                .map((token: any) => ({
                  ...token,
                  // balanceOracle fixes the number to the 10 decimal places, so here we should also fix it
                  balance: Number(token.balance.toFixed(10)),
                  // balanceOracle rounds to the second decimal places, so here we should also round it
                  balanceUSD: roundFloatingNumber(token.balanceUSD),
                  price: token.price || null,
                  network: network?.network
                }))
                .filter((token: any) => !!token.name && !!token.symbol),
              ...extraTokensAssets
            ]
    
            // Set the new data from velcro if we don't have any tokens yet
            // this can happen on first data update and we need to set our state
            // so the user doesnt wait too long seeing the loading state
            if (!assets?.tokens?.length) {
              setItems({ assetsByAccount: {
                ...response.data,
                tokens: formattedTokens,
                collectibles: nfts,
                cache: cache || false,
                cacheTime: cacheTime || prevCacheTime,
                loading: false,
                fetchingVelcro: false,
                network: currentNetwork
              }, key: `${account}-${currentNetwork}`})

              setAssetsByAccount(prev => ({
                ...prev,
                [`${account}-${currentNetwork}`]: {
                  ...prev[`${account}-${currentNetwork}`],
                  tokens: formattedTokens,
                  collectibles: nfts,
                  cache: cache || false,
                  cacheTime: cacheTime || prevCacheTime,
                  loading: false,
                  fetchingVelcro: false,
                  network: currentNetwork,
                }
              }))
            } else {
              setItems({ assetsByAccount: {
                ...response.data,
                tokens: formattedTokens,
                cache: cache || false,
                cacheTime: cacheTime || prevCacheTime,
                collectibles: nfts,
                loading: false,
                fetchingVelcro: false,
                network: currentNetwork
              }, key: `${account}-${currentNetwork}`})
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
                  fetchingVelcro: false,
                  network: currentNetwork
                }
              }))
            }
    
            updateCoingeckoAndSupplementData({ ...response.data,
              collectibles: nfts,
              cache: cache || false,
              cacheTime: cacheTime || prevCacheTime, tokens: formattedTokens })
            
            // Show error in case we have some
            // if (error) addToast(error, { error: true })
            
          } catch (e) {
            console.error('Balances API error', e)
            addToast(e.message, { error: true })
    
            setAssetsByAccount(prev => ({
                ...prev,
                [`${account}-${network}`]: {
                  ...prev[`${account}-${network}`],
                  error: e,
                  loading: false,
                  fetchingVelcro: false,
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