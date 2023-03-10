// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'

import useBalance from './useBalance'
import useExtraTokens from './useExtraTokens'
// eslint-disable-next-line import/no-cycle
import usePortfolioFetch from './usePortfolioFetch'
import useHiddenTokens from './useHiddenTokens'
import useTransactions from './useTransactions'

import { UsePortfolioProps, UsePortfolioReturnType } from './types'

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
  getCoingeckoCoin,
  relayerURL,
  useRelayerData,
  eligibleRequests,
  requests,
  selectedAccount,
  sentTxn,
  useCacheStorage,
  accounts,
  requestPendingState
}: UsePortfolioProps): UsePortfolioReturnType {
  const { constants } = useConstants()
  const { addToast } = useToasts()
  const isInitialMount = useRef(true)
  // Pending tokens which arent in constants tokenList
  const [pendingTokens, setPendingTokens] = useState([])
  // Implementation of structure that contains all assets by account and network
  const [assets, setAssetsByAccount, isInitializing] = useCacheStorage({
    key: 'ambire-assets',
    data: { accounts }
  })
  const [fetchingAssets, setFetchingAssets] = useState({})
  const [otherNetworksFetching, setOtherNetworksFetching] = useState(false)

  const currentAssets = useMemo(
    () => assets[`${account}-${currentNetwork}`],
    [assets, account, currentNetwork]
  )

  // In next lines, we are creating refs to already existing state variables,
  // in order to prevent useEffect circular dependencies (loops).
  // For example, useFetch accepts `assets` as parameter
  // and the same time useFetch is updating the `assets` via `setAssetsByAccount` internally.
  // In that case, if we add `assets` in the dep array of the wrapping useEffect hook,
  // it will result in an infinitive loop/updates.
  // Because of that - we are keeping part of the state in refs.
  const assetsRef = useRef<string>()
  useEffect(() => {
    assetsRef.current = assets
  }, [assets])

  const currentAssetsRef = useRef<string>()
  useEffect(() => {
    currentAssetsRef.current = currentAssets
  }, [currentAssets])

  const fetchingAssetsRef = useRef<string>()
  useEffect(() => {
    fetchingAssetsRef.current = fetchingAssets[`${account}-${currentNetwork}`]
  }, [fetchingAssets[`${account}-${currentNetwork}`]])

  const currentAccount = useRef<string>()
  useEffect(() => {
    currentAccount.current = account
  }, [account])

  // Handle logic for extra tokens
  const { extraTokens, getExtraTokensAssets, onAddExtraToken, onRemoveExtraToken } = useExtraTokens(
    {
      useStorage,
      useToasts,
      tokens: currentAssets?.tokens || [],
      constants
    }
  )

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
    filterByHiddenCollectibles
  } = useHiddenTokens({
    useToasts,
    useStorage
  })

  const collectibles = useMemo(
    () => filterByHiddenCollectibles(currentAssets?.collectibles || []) || [],
    [filterByHiddenCollectibles, currentAssets]
  )

  const tokens = useMemo(
    () => filterByHiddenTokens(currentAssets?.tokens || []) || [],
    [filterByHiddenTokens, currentAssets]
  )

  // All fetching logic required in our portfolio
  const {
    updateCoingeckoAndSupplementData,
    fetchOtherNetworksBalances,
    fetchAndSetSupplementTokenData,
    fetchTokens
  } = usePortfolioFetch({
    account,
    currentAccount,
    currentNetwork,
    hiddenTokens,
    getExtraTokensAssets,
    getBalances,
    addToast,
    setAssetsByAccount,
    getCoingeckoPrices,
    getCoingeckoPriceByContract,
    getCoingeckoCoin,
    filterByHiddenTokens,
    extraTokens,
    pendingTransactions,
    eligibleRequests,
    selectedAccount,
    constants,
    fetchingAssets,
    setFetchingAssets,
    otherNetworksFetching,
    setOtherNetworksFetching,
    requestPendingState,
    pendingTokens,
    setPendingTokens
  })

  // Implementation of balances calculation
  const { balance, otherBalances } = useBalance(
    account,
    assets,
    currentAssets,
    currentNetwork,
    filterByHiddenTokens
  )

  // Fetch tokens:
  // 1. After initialization
  // 2. On Network and account change
  useEffect(() => {
    if (!account || isInitializing) return

    // Prevent triggering the same request twice, if there is an ongoing one already triggered
    if (currentAssetsRef.current?.loading || fetchingAssetsRef.current?.velcro) return

    fetchTokens(account, currentNetwork, false, currentAssetsRef.current)
  }, [
    isInitializing,
    account,
    currentNetwork,
    fetchTokens
  ])

  // Fetch other network balances:
  // 1. After initialization
  // 2. On Account change
  useEffect(() => {
    if (!account || isInitializing) return

    fetchOtherNetworksBalances(account, assetsRef)
  }, [
    account,
    isInitializing
  ])

  // Refresh balance every 90s if visible
  // NOTE: this must be synced (a multiple of) supplementing, otherwise we can end up with weird inconsistencies
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (!isVisible) return

      fetchTokens(account, currentNetwork, false, currentAssetsRef.current)
    }, 90000)
    return () => clearInterval(refreshInterval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, currentNetwork, isVisible])

  // Fetch other networks assets every 60 seconds
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      if (!account) return

      fetchOtherNetworksBalances(account, assetsRef)
    }, 60000)
    return () => clearInterval(refreshInterval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  // Refresh balance every 150s if hidden
  useEffect(() => {
    const refreshIfHidden = () =>
      !isVisible && !currentAssetsRef.current?.loading && !isInitializing
        ? fetchTokens(account, currentNetwork, false, currentAssetsRef.current)
        : null
    const refreshInterval = setInterval(refreshIfHidden, 150000)
    return () => clearInterval(refreshInterval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    account,
    currentNetwork,
    isVisible,
    isInitializing,
    fetchTokens
  ])

  const refreshPricesAndBalance = useCallback(() => {
    updateCoingeckoAndSupplementData(currentAssets, false, requestPendingState)
  }, [
    currentAssets,
    requestPendingState,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    `${eligibleRequests}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    `${pendingTransactions}`,
    updateCoingeckoAndSupplementData
  ])

  // Get supplement tokens data every 20s and check if prices are 2 min old and fetch new ones
  useEffect(() => {
    const refreshInterval =
      !isInitializing &&
      setInterval(() => {
        refreshPricesAndBalance(currentAssets)
      }, 20000)
    return () => clearInterval(refreshInterval)
  }, [currentAssets, currentNetwork, isInitializing, refreshPricesAndBalance, extraTokens])

  useEffect(() => {
    if (isInitialMount.current) {
      if (!isInitializing) {
        isInitialMount.current = false
      }
    } else {
      // Your useEffect code here to be run on update
      fetchAndSetSupplementTokenData(currentAssetsRef, requestPendingState)
    }
    // In order to have an array in dependency we need to stringify it,
    // so we can be subscribed to changes of objects inside our arrays.
    // https://stackoverflow.com/a/65728647/8335898
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    eligibleRequests.toString(),
    pendingTransactions.toString(),
    requestPendingState,
    extraTokens,
    isInitializing
  ])

  return {
    balance,
    otherBalances,
    ...currentAssets,
    tokens,
    collectibles,
    isCurrNetworkBalanceLoading: isInitializing || currentAssets?.loading,
    balancesByNetworksLoading: otherNetworksFetching,
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
