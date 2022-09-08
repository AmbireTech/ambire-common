// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback, useEffect, useRef, useState } from 'react'

import supportedProtocols from '../../constants/supportedProtocols'
import { setKnownAddresses, setKnownTokens } from '../../services/humanReadableTransactions'
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
  getBalances
}: UsePortfolioProps): UsePortfolioReturnType {
  const { addToast } = useToasts()
  const rpcTokensLastUpdated = useRef<number>(0)
  const currentAccount = useRef<string>()
  const prevNetwork = usePrevious(currentNetwork)
  
  const [tokens, setTokens] = useState([])

  // Implement structure that contains all assets by account and network
  // assets: [
  //   [`${account}-${network.chainId}`]: {
  //     data: { tokens: [], nfts: [] },
  //     error: null,
  //     loading: true || false, - velcro update
  //     systemInfo: { cache, updatedAt, source: 'RPC' || 'velcro' } 
  //   }
  // ] 
  const [assets, setAssetsByAccount] = useState({})

  // Implementation of state handling and fetching of all balances by other networks (without current one)
  // balance: [
  //   totals: [
  //     { network: 'polygon', total: 2345.33 },
  //     { network: 'avalanche', total: 8.49 },
  //     { network: 'binance', total: 0 },
  //     { network: 'fantom', total: 5.33 }
  //   ],
  //   systemInfo: {},
  //   error: null
  // ]
  const [balances, setBalances] = useState({})

  // To be removed: This all state updates wont be needed with our new structure
  const [balancesByNetworksLoading, setBalancesByNetworksLoading] = useState<{
    [key in Network]: boolean
  }>({})
  const [otherProtocolsByNetworksLoading, setOtherProtocolsByNetworksLoading] = useState<{
    [key in Network]: boolean
  }>({})
  const [tokensByNetworks, setTokensByNetworks] = useState([])
  // Added unsupported networks (fantom and moonbeam) as default values with empty arrays to prevent crashes
  const [otherProtocolsByNetworks, setOtherProtocolsByNetworks] = useState(
    supportedProtocols.filter((item) => !item.protocols || !item.protocols.length)
  )
  const [collectibles, setCollectibles] = useState([])
  // To be removed: This wont be needed with our new structure - intending to update it in our assets state
  const [cachedBalancesByNetworks, setCachedBalancesByNetworks] = useState([])

  // Handle logic for extra tokens
  const { extraTokens, getExtraTokensAssets, onAddExtraToken, onRemoveExtraToken } = useExtraTokens({
    useStorage,
    useToasts,
    tokens
  })
  
  // All fetching logic required in our portfolio
  const {
    fetchSupplementTokenData, fetchOtherProtocols, fetchTokens
  } = usePortfolioFetch({
    account, currentAccount, currentNetwork, hiddenTokens, setAssetsByAccount, getExtraTokensAssets, setTokensByNetworks, getBalances, setOtherProtocolsByNetworks, setBalancesByNetworksLoading, setOtherProtocolsByNetworksLoading, setCachedBalancesByNetworks, otherProtocolsByNetworks, addToast, rpcTokensLastUpdated
  })

  // Implementation of balances calculation
  const { balance, otherBalances } = useBalance(tokensByNetworks, currentNetwork)

  
  // We need to be sure we get the latest balancesByNetworksLoading here
  const areAllNetworksBalancesLoading = useCallback(
    () => Object.values(balancesByNetworksLoading).every((ntwLoading) => ntwLoading),
    [balancesByNetworksLoading]
  )

  const refreshTokensIfVisible = useCallback(() => {
    if (!account) return
    if (isVisible && !areAllNetworksBalancesLoading()) {
      // Show loading only when switching between networks,
      // since showing it always when tokens are fetched is annoying
      // taking into consideration that refreshing happens automatically
      // on a certain interval or when user window (app) gets back in focus.
      const showLoadingState = prevNetwork !== currentNetwork
      fetchTokens(account, currentNetwork, showLoadingState, tokensByNetworks)
    }
  }, [account, fetchTokens, currentNetwork, isVisible])

  // Make humanizer 'learn' about new tokens and aliases
  const updateHumanizerData = (tokensByNetworks) => {
    const tokensList = Object.values(tokensByNetworks)
      .map(({ assets }) => assets)
      .flat(1)
    const knownAliases = tokensList.map(({ address, symbol }) => ({ address, name: symbol }))
    setKnownAddresses(knownAliases)
    setKnownTokens(tokensList)
  }

  const removeDuplicatedAssets = (tokens) => {
    const lookup = tokens.reduce((a, e) => {
      a[e.address] = ++a[e.address] || 0
      return a
    }, {})

    // filters by non duplicated objects or takes the one of dup but with a price greater than 0
    tokens = tokens.filter((e) => !lookup[e.address] || (lookup[e.address] && e.price))

    return tokens
  }

  async function loadBalance() {
    if (!account) return
    await fetchTokens(account, false, true, tokensByNetworks)
  }

  async function loadProtocols() {
    if (!account) return
    await fetchOtherProtocols(account, false, otherProtocolsByNetworks)
  }

  // Fetch balances and protocols on account change
  useEffect(() => {
    currentAccount.current = account

    loadBalance()
    loadProtocols()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, fetchTokens, fetchOtherProtocols])

  // To be removed: this logic can be handled on fetch 
  // Update states on network, tokens and ohterProtocols change
  useEffect(() => {
    try {
      const tokens = tokensByNetworks.find(({ network }) => network === currentNetwork)
      if (tokens) {
        tokens.assets = removeDuplicatedAssets(tokens.assets)
        setTokens(tokens.assets)
      }

      updateHumanizerData(tokensByNetworks)

      const otherProtocols = otherProtocolsByNetworks.find(
        ({ network }) => network === currentNetwork
      )
      if (tokens && otherProtocols) {
        setCollectibles(
          otherProtocols.protocols.find(({ label }) => label === 'NFTs')?.assets || []
        )
      }
    } catch (e) {
      console.error(e)
      addToast(e.message || e, { error: true })
    }
  }, [currentNetwork, tokensByNetworks, otherProtocolsByNetworks])

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
      !isVisible && !areAllNetworksBalancesLoading() ? fetchTokens(account, currentNetwork) : null
    const refreshInterval = setInterval(refreshIfHidden, 150000)
    return () => clearInterval(refreshInterval)
  }, [account, currentNetwork, isVisible, fetchTokens])

  // Get supplement tokens data every 20s
  useEffect(() => {
    const refreshInterval = setInterval(() => fetchSupplementTokenData(tokensByNetworks), 20000)
    return () => clearInterval(refreshInterval)
  }, [fetchSupplementTokenData, tokensByNetworks])

  return {
    balance,
    otherBalances,
    tokens,
    extraTokens,
    collectibles,
    onAddExtraToken,
    onRemoveExtraToken,
    // TODO: Export only current account and network data from here
    balancesByNetworksLoading,
    isCurrNetworkBalanceLoading: balancesByNetworksLoading[currentNetwork],
    isCurrNetworkProtocolsLoading: otherProtocolsByNetworksLoading[currentNetwork],
    cachedBalancesByNetworks,
  }
}