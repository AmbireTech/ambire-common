// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback } from 'react'

import { ethers } from 'ethers'
import supportedProtocols from '../../../constants/supportedProtocols'
import networks from '../../../constants/networks'
import { roundFloatingNumber } from '../../../services/formatter'

export default function useVelcroFetch({
  currentAccount,
  currentNetwork: currNetwork,
  setAssetsByAccount,
  addToast,
  getBalances,
  filterByHiddenTokens,
  updateCoingeckoAndSupplementData,
  extraTokensAssets,
  getExtraTokensAssets,
  eligibleRequests,
  fetchingAssets,
  setFetchingAssets,
  оtherNetworksFetching,
  setOtherNetworksFetching,
  removeDuplicatedAssets
}) {
  const formatTokensResponse = (tokens, assets, network, account) => {
    const extraTokens = getExtraTokensAssets(account, network)
    return removeDuplicatedAssets([
      ...tokens
        .map((token: any) => {
          const prevToken =
            assets?.tokens?.length && assets?.tokens.find((t) => t.address === token.address)
          let updatedData = {}
          if (!prevToken) return { ...token }
          const { balance, balanceUSD, balanceUpdate, price, priceUpdate, ...newData } = token
          updatedData = {
            ...prevToken,
            ...newData
          }

          if (
            !prevToken?.balanceOracleUpdate ||
            token.balanceUpdate > prevToken?.balanceOracleUpdate ||
            token.balanceUpdate > prevToken?.balanceUpdate
          ) {
            // update balance
            updatedData = {
              ...updatedData,
              balance,
              balanceUpdate
            }
          }

          if (
            !prevToken?.priceUpdate ||
            (token?.priceUpdate > prevToken?.priceUpdate &&
              token.priceUpdate - prevToken.priceUpdate >= 5 * 60 * 1000)
          ) {
            // update price
            updatedData = {
              ...updatedData,
              price,
              priceUpdate
            }
          }
          return updatedData
        })
        .map((token: any) => ({
          ...token,
          // balanceOracle fixes the number to the 10 decimal places, so here we should also fix it
          balance: token?.balance
            ? Number(token?.balance?.toFixed(10))
            : Number(ethers.utils.formatUnits(token?.balanceRaw, token?.decimals)).toFixed(10),
          // Update balanceUSD in case its old but price is new
          balanceUSD: roundFloatingNumber(
            Number(parseFloat((token?.balance || 0) * (token?.price || 0)).toFixed(2))
          ),
          price: token?.price || null,
          network
        }))
        .filter((token: any) => !!token.name && !!token.symbol),
      ...extraTokens
    ])
  }
  const fetchOtherNetworksBalances = async (account, assets) => {
    if (!оtherNetworksFetching) {
      setOtherNetworksFetching(true)
    }
    const networksToFetch = supportedProtocols
      .filter(({ network }) => network !== currNetwork)
      .filter(({ network }) => !networks.find(({ id }) => id === network)?.relayerlessOnly)
    try {
      Promise.all(
        networksToFetch.map(async ({ network, balancesProvider }) => {
          try {
            const response = await getBalances(network, account, balancesProvider)
            if (!response) return null
            const currentAssetsKey =
              Object.keys(assets).length &&
              Object.keys(assets).filter((key) => key.includes(account) && key.includes(network))
            const currentAssets = assets[currentAssetsKey]
            const prevCacheTime = (currentAssetsKey && assets[currentAssetsKey]?.cacheTime) || null
            // eslint-disable-next-line prefer-const
            let { tokens = [], nfts, cache, cacheTime, resultTime, provider } = response.data

            const shouldSkipUpdate = cache && new Date(cacheTime) < new Date(prevCacheTime)
            cache = shouldSkipUpdate || false

            if (cacheTime === prevCacheTime) {
              setAssetsByAccount((prev) => ({
                ...prev,
                [`${account}-${network}`]: {
                  ...prev[`${account}-${network}`],
                  tokens: removeDuplicatedAssets([
                    ...(currentAssets?.tokens ? currentAssets.tokens : []),
                    ...(extraTokensAssets?.length ? extraTokensAssets : [])
                  ])
                }
              }))
              return true
            }

            let formattedTokens = []

            // velcro provider is balanceOracle and tokens may not be full
            // repopulate with current tokens
            if (provider === 'balanceOracle') {
              formattedTokens = removeDuplicatedAssets([
                ...(currentAssets?.tokens || []),
                ...tokens
              ])
            }

            formattedTokens = formatTokensResponse(
              formattedTokens.length ? [...(formattedTokens || [])] : [...tokens] || [],
              assets[currentAssetsKey],
              network,
              account
            )
            formattedTokens = filterByHiddenTokens(formattedTokens)
            setAssetsByAccount((prev) => ({
              ...prev,
              [`${account}-${network}`]: {
                ...prev[`${account}-${network}`],
                resultTime,
                cache: cache || false,
                cacheTime: cacheTime || prevCacheTime,
                tokens: formattedTokens,
                collectibles: nfts,
                loading: false,
                network
              }
            }))
            return true
          } catch (e) {
            setAssetsByAccount((prev) => ({
              ...prev,
              [`${account}-${network}`]: {
                ...prev[`${account}-${network}`],
                loading: false
              }
            }))
            return false
          }
        })
      ).then(() => {
        setOtherNetworksFetching(false)
      })
    } catch (e) {
      setOtherNetworksFetching(false)
      addToast(e.message, { error: true })
    }
  }

  // Full update of tokens
  const fetchTokens = useCallback(
    // eslint-disable-next-line default-param-last
    async (account: string, currentNetwork: NetworkId, showLoadingState = false, assets = []) => {
      // Prevent race conditions and multiple fetchings
      if (
        currentAccount.current !== account ||
        fetchingAssets[`${account}-${currentNetwork}`]?.velcro
      )
        return

      setFetchingAssets((prev) => ({
        ...prev,
        [`${account}-${currentNetwork}`]: {
          ...prev[`${account}-${currentNetwork}`],
          velcro: true
        }
      }))

      if (showLoadingState || !assets?.tokens?.length) {
        setAssetsByAccount((prev) => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            loading: true
          }
        }))
      }

      const networkToFetch = supportedProtocols.find(({ network }) => network === currentNetwork)

      try {
        const quickResponse = !assets?.tokens?.length
        const response = await getBalances(
          currentNetwork,
          account,
          networkToFetch.balancesProvider,
          quickResponse
        )
        if (!response) return null

        // eslint-disable-next-line prefer-const
        let { cache, cacheTime, tokens, nfts, partial, provider } = response.data

        tokens = filterByHiddenTokens(tokens)
        const prevCacheTime = assets?.cacheTime
        // We should skip the tokens update for the current network,
        // in the case Velcro returns a cached data, which is more outdated than the already fetched data or we have partial data.
        const shouldSkipUpdate = (cache && new Date(cacheTime) < new Date(prevCacheTime)) || partial

        if (cacheTime === prevCacheTime) {
          setFetchingAssets((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              velcro: false
            }
          }))
          setAssetsByAccount((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              tokens: removeDuplicatedAssets([
                ...(assets?.tokens ? assets.tokens : []),
                ...(extraTokensAssets?.length ? extraTokensAssets : [])
              ])
            }
          }))
        }

        cache = shouldSkipUpdate || false
        // Tokens with balanceUpdate newer than balanceOracles update
        const tokensToUpdateBalance = tokens.filter((newToken) =>
          assets?.tokens?.length
            ? assets?.tokens.find(
                (t) =>
                  t.address === newToken.address && newToken.balanceUpdate > t?.balanceOracleUpdate
              )
            : newToken
        )

        let formattedTokens = []

        // velcro provider is balanceOracle and tokens may not be full
        // repopulate with current tokens and pass them to balanceOracle
        if (provider === 'balanceOracle' || partial) {
          formattedTokens = removeDuplicatedAssets([...(assets?.tokens || []), ...tokens])
        }

        // In case we have cached data from velcro - call balance oracle
        if ((!quickResponse && shouldSkipUpdate) || !tokensToUpdateBalance.length) {
          if (!formattedTokens?.length) {
            formattedTokens = assets?.tokens
          }
          formattedTokens = removeDuplicatedAssets([
            ...(formattedTokens || []),
            ...(extraTokensAssets?.length ? extraTokensAssets : [])
          ])
          setFetchingAssets((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              velcro: false
            }
          }))
          updateCoingeckoAndSupplementData(
            {
              ...response.data,
              collectibles: nfts,
              cache: cache || false,
              cacheTime: cacheTime || prevCacheTime,
              tokens: formattedTokens
            },
            5
          )
          return
        }
        formattedTokens = formatTokensResponse(tokens, assets, networkToFetch?.network, account)
        // Set the new data from velcro if we don't have any tokens yet
        // this can happen on first data update and we need to set our state
        // so the user doesnt wait too long seeing the loading state
        if (!assets?.tokens?.length) {
          setAssetsByAccount((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              tokens: formattedTokens,
              collectibles: nfts,
              cache: cache || false,
              cacheTime: cacheTime || prevCacheTime,
              loading: false,
              network: currentNetwork
            }
          }))
        } else {
          // Otherwise wait for balance Oracle to set our tokens in state,
          // but still there is a need to update the loading state and other data.
          setAssetsByAccount((prev) => ({
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
        setFetchingAssets((prev) => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            velcro: false
          }
        }))
        updateCoingeckoAndSupplementData(
          {
            ...response.data,
            collectibles: nfts,
            cache: cache || false,
            cacheTime: cacheTime || prevCacheTime,
            tokens: formattedTokens
          },
          5
        )

        // Show error in case we have some
        // if (error) addToast(error, { error: true })
      } catch (e) {
        console.error('Balances API error', e)
        addToast(e.message, { error: true })

        setFetchingAssets((prev) => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            velcro: false
          }
        }))

        setAssetsByAccount((prev) => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            error: e,
            loading: false
          }
        }))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extraTokensAssets, addToast, eligibleRequests, currentAccount, formatTokensResponse]
  )
  return {
    fetchOtherNetworksBalances,
    fetchTokens
  }
}
