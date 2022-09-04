// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import useBalance from './useBalance'
import usePrevious from '../usePrevious'
import useExtraTokens from './useExtraTokens'
import usePortfolioFetch from './usePortfolioFetch'
import useHiddenTokens from './useHiddenTokens'

import {
  Network,
  UsePortfolioProps,
  UsePortfolioReturnType
} from './types'

export default function usePortfolio({
  currentNetwork,
  account,
  useStorage,
  isVisible,
  useToasts,
  getBalances,
  getCoingeckoPrices
}: UsePortfolioProps): UsePortfolioReturnType {
  const { addToast } = useToasts()
  const rpcTokensLastUpdated = useRef<number>(0)
  const currentAccount = useRef<string>()
  const prevNetwork = usePrevious(currentNetwork)

  // Implementation of structure that contains all assets by account and network
  const [assets, setAssetsByAccount] = useStorage({ key: 'assets', defaultValue: {} })

  const [pricesFetching, setPricesFetching] = useState(false)

  // Handle logic for extra tokens
  const { extraTokens, getExtraTokensAssets, onAddExtraToken, onRemoveExtraToken } = useExtraTokens({
    useStorage,
    useToasts,
    tokens: assets[`${account}-${currentNetwork}`]?.tokens || []
  })
  
  const {
    onAddHiddenToken,
    onRemoveHiddenToken,
    setHiddenTokens,
    hiddenTokens,
    filterByHiddenTokens,
  } = useHiddenTokens({
    useToasts,
    useStorage,
  })
  
  // All fetching logic required in our portfolio
  const {
    fetchSupplementTokenData, fetchOtherNetworksBalances, fetchTokens, fetchCoingeckoPrices
  } = usePortfolioFetch({
    account, currentAccount, currentNetwork, hiddenTokens, getExtraTokensAssets, getBalances, addToast, rpcTokensLastUpdated, setAssetsByAccount,
    getCoingeckoPrices,
    setPricesFetching,
    filterByHiddenTokens,
    extraTokens
  })

  // Implementation of balances calculation
  const { balance, otherBalances } = useBalance(account, assets, assets[`${account}-${currentNetwork}`], currentNetwork, filterByHiddenTokens)

  const refreshTokensIfVisible = useCallback(() => {
    if (!account) return
    if (isVisible && !assets[`${account}-${currentNetwork}`]?.loading) {
      // Show loading only when switching between networks,
      // since showing it always when tokens are fetched is annoying
      // taking into consideration that refreshing happens automatically
      // on a certain interval or when user window (app) gets back in focus.
      const showLoadingState = prevNetwork !== currentNetwork
      fetchTokens(account, currentNetwork, showLoadingState, assets[`${account}-${currentNetwork}`])
    }
  }, [account, fetchTokens, prevNetwork, currentNetwork, isVisible])

  async function loadBalance() {
    if (!account) return
    await fetchTokens(account, currentNetwork, true, assets[`${account}-${currentNetwork}`])
  }

  async function loadOtherNetworksBalances() {
    if (!account) return
    await fetchOtherNetworksBalances(account, currentNetwork)
  }

  // Fetch balances and protocols on account and network change
  useEffect(() => {
    currentAccount.current = account
    loadBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, currentNetwork])
  
  // Fetch other networks balances on account change
  useEffect(() => {
    loadOtherNetworksBalances()
  }, [account])

  // Reset `rpcTokensLastUpdated` on a network change, because its value is regarding the previous network,
  // and it's not useful for the current network.
  useEffect(() => {
    rpcTokensLastUpdated.current = 0
  }, [currentNetwork])

  // Refresh tokens on network change or when the window (app) is considered to be visible to the user
  useEffect(() => {
    refreshTokensIfVisible()
  }, [currentNetwork, isVisible, refreshTokensIfVisible])

  // Refresh balance every 90s if visible
  // NOTE: this must be synced (a multiple of) supplementing, otherwise we can end up with weird inconsistencies
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const refreshInterval = setInterval(refreshTokensIfVisible, 90000)
    return () => clearInterval(refreshInterval)
  }, [refreshTokensIfVisible])

  // Check if prices are 2 min old and fetch new ones on every 20 seconds
  useEffect(() => {
    function refreshPrices() {
      const coingeckoTokensToUpdate = assets[`${account}-${currentNetwork}`]?.tokens?.filter(token => token.coingeckoId).some(token => { 
        if (((new Date().valueOf() - token.priceUpdate) >= 2*60*1000)) {
          return token
        }
      })
      
      if (coingeckoTokensToUpdate && !assets[`${account}-${currentNetwork}`]?.loading && !pricesFetching) {
        fetchCoingeckoPrices(assets[`${account}-${currentNetwork}`])
      }
    }
    const refreshInterval = setInterval(refreshPrices, 20000)
    return () => clearInterval(refreshInterval)
  }, [assets[`${account}-${currentNetwork}`]])
  
  // Fetch other networks assets every 20 seconds
  useEffect(() => {
    const refreshInterval = setInterval(loadOtherNetworksBalances, 20000)
    return () => clearInterval(refreshInterval)
  }, [])

  // Refresh balance every 150s if hidden
  useEffect(() => {
    const refreshIfHidden = () =>
      !isVisible && !assets[`${account}-${currentNetwork}`]?.loading ? fetchTokens(account, currentNetwork) : null
    const refreshInterval = setInterval(refreshIfHidden, 150000)
    return () => clearInterval(refreshInterval)
  }, [account, currentNetwork, isVisible, fetchTokens])

  // Get supplement tokens data every 20s
  useEffect(() => {
    const refreshInterval = setInterval(() => fetchSupplementTokenData(assets[`${account}-${currentNetwork}`]), 20000)
    return () => clearInterval(refreshInterval)
  }, [fetchSupplementTokenData, assets[`${account}-${currentNetwork}`]])

  // We need to be sure we get the latest balancesByNetworksLoading here
  const balancesByNetworksLoading = useMemo(
    () => {
      return Object.keys(assets).filter(key => {
        return key.includes(account) && !key.includes(currentNetwork)
      }).every(key => assets[key]?.loading)
    },
    [assets, account, currentNetwork]
  )

  return {
    balance,
    otherBalances,
    ...assets[`${account}-${currentNetwork}`],
    tokens: filterByHiddenTokens(assets[`${account}-${currentNetwork}`]?.tokens || []) || [],
    collectibles: assets[`${account}-${currentNetwork}`]?.collectibles || [],
    isCurrNetworkBalanceLoading: assets[`${account}-${currentNetwork}`]?.loading,
    balancesByNetworksLoading,
    extraTokens,
    onAddExtraToken,
    onRemoveExtraToken,
    onAddHiddenToken,
    onRemoveHiddenToken,
    setHiddenTokens,
    hiddenTokens,
  }
}