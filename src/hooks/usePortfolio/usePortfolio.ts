// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'

import useBalance from './useBalance'
import usePrevious from '../usePrevious'
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
  useIndexedDBStorage
}: UsePortfolioProps): UsePortfolioReturnType {
  const { constants } = useConstants()
  const { addToast } = useToasts()
  const currentAccount = useRef<string>()
  const prevNetwork = usePrevious(currentNetwork)
  const isInitialMount = useRef(true);
  const [assets, setItems, isLoading, shouldStartFetching] = useIndexedDBStorage({ dbName: 'ambire-assets', version: 1 })

  // Implementation of structure that contains all assets by account and network
  const [assetsByAccounts, setAssetsByAccount] = useState(assets)
  const currentAssets = useMemo(() => assetsByAccounts[`${account}-${currentNetwork}`] || assets[`${account}-${currentNetwork}`], [account, currentNetwork, assetsByAccounts[`${account}-${currentNetwork}`], assets[`${account}-${currentNetwork}`]])
  const accountsAssets = useMemo(() => assetsByAccounts || assets, [assetsByAccounts, assets])

  useEffect(() => {
    setAssetsByAccount(assets)
  }, [isLoading])
  
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
    setItems
  })

  // Implementation of balances calculation
  const { balance, otherBalances } = useBalance(account, accountsAssets, currentAssets, currentNetwork, filterByHiddenTokens)

  const refreshTokensIfVisible = useCallback(() => {
    if (!account || !shouldStartFetching) return
    if (isVisible && !currentAssets?.loading) {
      fetchTokens(account, currentNetwork, false, currentAssets)
    }
  }, [account, fetchTokens, prevNetwork, currentNetwork, isVisible, shouldStartFetching])
  
  async function loadBalance() {
    if (!account || !shouldStartFetching) return
    await fetchTokens(account, currentNetwork, false, currentAssets)
  }

  async function loadOtherNetworksBalances() {
    if (!account || !shouldStartFetching) return
    await fetchOtherNetworksBalances(account, accountsAssets)
  }

  // Fetch balances and protocols on account and network change
  useEffect(() => {
    currentAccount.current = account
    loadBalance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, currentNetwork, shouldStartFetching])
  
  // Fetch other networks balances on account change
  useEffect(() => {
    loadOtherNetworksBalances()
  }, [account, shouldStartFetching])

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

  // Fetch other networks assets every 60 seconds
  useEffect(() => {
    const refreshInterval = setInterval(loadOtherNetworksBalances, 60000)
    return () => clearInterval(refreshInterval)
  }, [account, currentNetwork, shouldStartFetching])

  // Refresh balance every 150s if hidden
  useEffect(() => {
    const refreshIfHidden = () =>
      !isVisible && !currentAssets?.loading || shouldStartFetching ? fetchTokens(account, currentNetwork, false, currentAssets) : null
    const refreshInterval = setInterval(refreshIfHidden, 150000)
    return () => clearInterval(refreshInterval)
  }, [account, currentNetwork, isVisible, fetchTokens, shouldStartFetching])

  // Get supplement tokens data every 20s and check if prices are 2 min old and fetch new ones
  useEffect(() => {
    const refreshInterval = shouldStartFetching && setInterval(() => {
      updateCoingeckoAndSupplementData(currentAssets)
    }, 20000)
    return () => clearInterval(refreshInterval)
  }, [currentAssets, currentNetwork, shouldStartFetching])

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
    } else {
      // Your useEffect code here to be run on update
      fetchAndSetSupplementTokenData(currentAssets)
    }
    // In order to have an array in dependency we need to stringify it,
    // so we can be subscribed to changes of objects inside our arrays. 
    // https://stackoverflow.com/a/65728647/8335898
  }, [`${eligibleRequests}`, `${pendingTransactions}`])

  // We need to be sure we get the latest balancesByNetworksLoading here
  const balancesByNetworksLoading = useMemo(
    () => {
      return Object.keys(assetsByAccounts).filter(key => {
        return key.includes(account) && !key.includes(currentNetwork)
      }).every(key => assetsByAccounts[key]?.loading)
    },
    [assetsByAccounts, account, currentNetwork]
  )

  return {
    balance,
    otherBalances,
    ...currentAssets,
    tokens: tokens,
    collectibles: collectibles,
    isCurrNetworkBalanceLoading: isLoading || currentAssets?.loading,
    balancesByNetworksLoading,
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