// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'

import useBalance from './useBalance'
import useExtraTokens from './useExtraTokens'
import usePortfolioFetch from './usePortfolioFetch'
import useHiddenTokens from './useHiddenTokens'
import useTransactions from './useTransactions'

import {
  Network,
  UsePortfolioProps,
  UsePortfolioReturnType
} from './types'

export default function usePortfolio({
  useConstants,
  currentNetwork,
  account,
  useStorage,
  isVisible,
  useToasts,
  getBalances,
  getCoingeckoPrices,
  getCoingeckoPriceByContract,
  getCoingeckoAssetPlatforms,
  relayerURL,
  useRelayerData,
  eligibleRequests,
  requests,
  selectedAccount,
  sentTxn,
  useCacheStorage,
  accounts
}: UsePortfolioProps): UsePortfolioReturnType {
  const { constants } = useConstants()
  const { addToast } = useToasts()
  const currentAccount = useRef<string>()
  const isInitialMount = useRef(true);

  // Implementation of structure that contains all assets by account and network
  const [assets, setAssetsByAccount, isInitializing] = useCacheStorage({ key: 'ambire-assets', data: { accounts} })
  const [fetchingAssets, setFetchingAssets] = useState({})
  const [оtherNetworksFetching, setOtherNetworksFetching] = useState(false)

  const currentAssets = useMemo(() => assets[`${account}-${currentNetwork}`], [account, currentNetwork, assets[`${account}-${currentNetwork}`]])
  
  // Handle logic for extra tokens
  const { extraTokens, getExtraTokensAssets, onAddExtraToken, onRemoveExtraToken } = useExtraTokens({
    useStorage,
    useToasts,
    tokens: currentAssets?.tokens || [],
    constants
  })

  const { pendingTransactions } = useTransactions({
    account,
    currentNetwork,
    relayerURL,
    useRelayerData,
    requests,
    sentTxn
  })

  const {
    onAddHiddenToken,
    onRemoveHiddenToken,
    setHiddenTokens,
    hiddenTokens,
    filterByHiddenTokens,
    onAddHiddenCollectible,
    onRemoveHiddenCollectible,
    setHiddenCollectibles,
    hiddenCollectibles,
    filterByHiddenCollectibles,
  } = useHiddenTokens({
    useToasts,
    useStorage,
  })

  const collectibles = useMemo(() => filterByHiddenCollectibles(currentAssets?.collectibles || []) || [], [hiddenCollectibles, account, currentNetwork, currentAssets]);

  const tokens = useMemo(() => filterByHiddenTokens(currentAssets?.tokens || []) || [], [hiddenTokens, account, currentNetwork, currentAssets]);
  
  // All fetching logic required in our portfolio
  const {
    updateCoingeckoAndSupplementData, fetchOtherNetworksBalances, fetchAndSetSupplementTokenData, fetchTokens
  } = usePortfolioFetch({
    account, currentAccount, currentNetwork, hiddenTokens, getExtraTokensAssets, getBalances, addToast, setAssetsByAccount,
    getCoingeckoPrices,
    getCoingeckoPriceByContract,
    getCoingeckoAssetPlatforms,
    filterByHiddenTokens,
    extraTokens,
    pendingTransactions, eligibleRequests, selectedAccount, constants,
    fetchingAssets,
    setFetchingAssets,
    оtherNetworksFetching,
    setOtherNetworksFetching
  })

  // Implementation of balances calculation
  const { balance, otherBalances } = useBalance(account, assets, currentAssets, currentNetwork, filterByHiddenTokens)

  const refreshTokensIfVisible = useCallback(() => {
    if (!account || isInitializing) return
    if (isVisible && !currentAssets?.loading && !fetchingAssets[`${account}-${currentNetwork}`]?.velcro) {
      fetchTokens(account, currentNetwork, false, currentAssets)
    }
  }, [account, fetchTokens, currentNetwork, isVisible, isInitializing])
  
  async function loadBalance() {
    if (!account || isInitializing) return
    await fetchTokens(account, currentNetwork, false, currentAssets)
  }

  async function loadOtherNetworksBalances() {
    if (!account || isInitializing) return
    await fetchOtherNetworksBalances(account, assets)
  }

  // Fetch balances on account change
  // Fetch other networks balances on account change
  useEffect(() => {
    currentAccount.current = account
    loadBalance()
    loadOtherNetworksBalances()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, isInitializing])

  // Refresh tokens on network change or when the window (app) is considered to be visible to the user
  useEffect(() => {
    if (isInitialMount.current) {
      if (!isInitializing) {
        isInitialMount.current = false;
      }
    } else {
      refreshTokensIfVisible()
    }
  }, [currentNetwork, isVisible, refreshTokensIfVisible, isInitializing])

  // Refresh balance every 90s if visible
  // NOTE: this must be synced (a multiple of) supplementing, otherwise we can end up with weird inconsistencies
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const refreshInterval = setInterval(refreshTokensIfVisible, 90000)
    return () => clearInterval(refreshInterval)
  }, [refreshTokensIfVisible])

  // Fetch other networks assets every 60 seconds
  useEffect(() => {
    const refreshInterval = setInterval(loadOtherNetworksBalances, 60000)
    return () => clearInterval(refreshInterval)
  }, [account, currentNetwork, isInitializing])

  // Refresh balance every 150s if hidden
  useEffect(() => {
    const refreshIfHidden = () =>
      !isVisible && !currentAssets?.loading && !isInitializing ? fetchTokens(account, currentNetwork, false, currentAssets) : null
    const refreshInterval = setInterval(refreshIfHidden, 150000)
    return () => clearInterval(refreshInterval)
  }, [account, currentNetwork, isVisible, fetchTokens, isInitializing])

  // Get supplement tokens data every 20s and check if prices are 2 min old and fetch new ones
  useEffect(() => {
    const refreshInterval = !isInitializing && setInterval(() => {
      updateCoingeckoAndSupplementData(currentAssets)
    }, 20000)
    return () => clearInterval(refreshInterval)
  }, [currentAssets, currentNetwork, isInitializing])

  useEffect(() => {
    if (isInitialMount.current) {
      if (!isInitializing) {
        isInitialMount.current = false;
      }
    } else {
      // Your useEffect code here to be run on update
      fetchAndSetSupplementTokenData(currentAssets)
    }
    // In order to have an array in dependency we need to stringify it,
    // so we can be subscribed to changes of objects inside our arrays. 
    // https://stackoverflow.com/a/65728647/8335898
  }, [`${eligibleRequests}`, `${pendingTransactions}`, isInitializing])

  return {
    balance,
    otherBalances,
    ...currentAssets,
    tokens: tokens,
    collectibles: collectibles,
    isCurrNetworkBalanceLoading: isInitializing || currentAssets?.loading,
    balancesByNetworksLoading: оtherNetworksFetching,
    extraTokens,
    onAddExtraToken,
    onRemoveExtraToken,
    onAddHiddenToken,
    onRemoveHiddenToken,
    setHiddenTokens,
    hiddenTokens,
    onAddHiddenCollectible,
    onRemoveHiddenCollectible,
    setHiddenCollectibles,
    hiddenCollectibles
  }
}