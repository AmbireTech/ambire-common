// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback, useEffect, useMemo, useRef } from 'react'

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
  selectedAccount
}: UsePortfolioProps): UsePortfolioReturnType {
  const { addToast } = useToasts()
  const currentAccount = useRef<string>()
  const prevNetwork = usePrevious(currentNetwork)

  // Implementation of structure that contains all assets by account and network
  const [assets, setAssetsByAccount] = useStorage({ key: 'assets', defaultValue: {} })
  const currentAssets = assets[`${account}-${currentNetwork}`]

  // Handle logic for extra tokens
  const { extraTokens, getExtraTokensAssets, onAddExtraToken, onRemoveExtraToken } = useExtraTokens({
    useStorage,
    useToasts,
    tokens: currentAssets?.tokens || []
  })

  const { pendingTransactions } = useTransactions({
    account,
    currentNetwork,
    relayerURL,
    useRelayerData,
    eligibleRequests,
    requests
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
    pendingTransactions, eligibleRequests, selectedAccount, humanizers
  })

  // Implementation of balances calculation
  const { balance, otherBalances } = useBalance(account, assets, currentAssets, currentNetwork, filterByHiddenTokens)

  const refreshTokensIfVisible = useCallback(() => {
    if (!account) return
    if (isVisible && !currentAssets?.loading) {
      // Show loading only when switching between networks,
      // since showing it always when tokens are fetched is annoying
      // taking into consideration that refreshing happens automatically
      // on a certain interval or when user window (app) gets back in focus.
      const showLoadingState = prevNetwork !== currentNetwork
      fetchTokens(account, currentNetwork, showLoadingState, currentAssets)
    }
  }, [account, fetchTokens, prevNetwork, currentNetwork, isVisible])

  async function loadBalance() {
    if (!account) return
    await fetchTokens(account, currentNetwork, true, currentAssets)
  }

  async function loadOtherNetworksBalances() {
    if (!account) return
    await fetchOtherNetworksBalances(account)
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

  // Fetch other networks assets every 20 seconds
  useEffect(() => {
    const refreshInterval = setInterval(loadOtherNetworksBalances, 20000)
    return () => clearInterval(refreshInterval)
  }, [])

  // Refresh balance every 150s if hidden
  useEffect(() => {
    const refreshIfHidden = () =>
      !isVisible && !currentAssets?.loading ? fetchTokens(account, currentNetwork, false, currentAssets) : null
    const refreshInterval = setInterval(refreshIfHidden, 150000)
    return () => clearInterval(refreshInterval)
  }, [account, currentNetwork, isVisible, fetchTokens])

  // Get supplement tokens data every 20s and check if prices are 2 min old and fetch new ones
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      updateCoingeckoAndSupplementData(currentAssets)
    }, 20000)
    return () => clearInterval(refreshInterval)
  }, [requests, eligibleRequests, pendingTransactions])

  useEffect(() => {
    fetchAndSetSupplementTokenData(currentAssets)
  }, [requests, `${eligibleRequests}`, `${pendingTransactions}`])

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
    ...currentAssets,
    tokens: tokens,
    collectibles: currentAssets?.collectibles || [],
    isCurrNetworkBalanceLoading: currentAssets?.loading,
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