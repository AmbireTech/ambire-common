// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback, useEffect, useRef, useState } from 'react'

import useBalance from './useBalance'
import usePrevious from '../usePrevious'
import useExtraTokens from './useExtraTokens'
import usePortfolioFetch from './usePortfolioFetch'

import {
  Network,
  UsePortfolioProps,
  UsePortfolioReturnType
} from './types'

export default function usePortfolio({
  currentNetwork,
  account,
  useStorage,
  hiddenTokens,
  isVisible,
  useToasts,
  getBalances,
  getOtherNetworksTotals,
  getCoingeckoPrices
}: UsePortfolioProps): UsePortfolioReturnType {
  const { addToast } = useToasts()
  const rpcTokensLastUpdated = useRef<number>(0)
  const currentAccount = useRef<string>()
  const prevNetwork = usePrevious(currentNetwork)

  // Implement structure that contains all assets by account and network
  const [assets, setAssetsByAccount] = useState({})

  // Implementation of state handling and fetching of all balances by other networks (without current one)
  const [balances, setBalances] = useState({})

  // Handle logic for extra tokens
  const { extraTokens, getExtraTokensAssets, onAddExtraToken, onRemoveExtraToken } = useExtraTokens({
    useStorage,
    useToasts,
    tokens: assets[`${account}-${currentNetwork}`]?.tokens || []
  })
  
  // All fetching logic required in our portfolio
  const {
    fetchSupplementTokenData, fetchOtherNetworksBalances, fetchTokens
  } = usePortfolioFetch({
    account, currentAccount, currentNetwork, hiddenTokens, setAssetsByAccount, getExtraTokensAssets, getBalances, setBalances, addToast, rpcTokensLastUpdated, getOtherNetworksTotals,
    getCoingeckoPrices
  })

  // Implementation of balances calculation
  const { balance, otherBalances } = useBalance(balances, assets[`${account}-${currentNetwork}`], currentNetwork)

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
    await fetchOtherNetworksBalances(account, currentNetwork, balances)
  }

  // Fetch balances and protocols on account change
  useEffect(() => {
    currentAccount.current = account

    loadBalance()
    loadOtherNetworksBalances()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, currentNetwork])

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

  return {
    balance,
    otherBalances,
    ...assets[`${account}-${currentNetwork}`],
    tokens: assets[`${account}-${currentNetwork}`]?.tokens || [],
    collectibles: assets[`${account}-${currentNetwork}`]?.collectibles || [],
    isCurrNetworkBalanceLoading: assets[`${account}-${currentNetwork}`]?.loading,
    balancesByNetworksLoading: balances?.loading,
    extraTokens,
    onAddExtraToken,
    onRemoveExtraToken,
  }
}