// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useCallback, useEffect, useRef, useState } from 'react'

import { NetworkId } from '../../constants/networks'
import supportedProtocols from '../../constants/supportedProtocols'
import { checkTokenList, getTokenListBalance, tokenList } from '../../services/balanceOracle'
import { roundFloatingNumber } from '../../services/formatter'
import { setKnownAddresses, setKnownTokens } from '../../services/humanReadableTransactions'
import useBalance from './useBalance'
import usePrevious from '../usePrevious'
import useExtraTokens from './useExtraTokens'
import useFetch from './useFetch'

import {
  Network,
  Token,
  UsePortfolioProps,
  UsePortfolioReturnType
} from './types'

let lastOtherProtocolsRefresh: number = 0

// use Balance Oracle
function paginateArray(input: any[], limit: number) {
  const pages = []
  let from = 0
  for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
    pages.push(input.slice(from, i * limit))
    from += limit
  }
  return pages
}

async function supplementTokensDataFromNetwork({
  walletAddr,
  network,
  tokensData,
  extraTokens,
  updateBalance,
}: {
  walletAddr: string
  network: Network
  tokensData: Token[]
  extraTokens: Token[]
  updateBalance?: string
}) {
  if (!walletAddr || walletAddr === '' || !network) return []
  // eslint-disable-next-line no-param-reassign
  if (!tokensData || !tokensData[0]) tokensData = checkTokenList(tokensData || []) // tokensData check and populate for test if undefind
  // eslint-disable-next-line no-param-reassign
  if (!extraTokens || !extraTokens[0]) extraTokens = checkTokenList(extraTokens || []) // extraTokens check and populate for test if undefind

  // concat predefined token list with extraTokens list (extraTokens are certainly ERC20)
  const fullTokenList = [
    // @ts-ignore figure out how to add types for the `tokenList`
    ...new Set(tokenList[network] ? tokenList[network].concat(extraTokens) : [...extraTokens])
  ]
  const tokens = fullTokenList.map((t: any) => {
    return tokensData.find((td) => td.address === t.address) || t
  })
  const tokensNotInList = tokensData.filter((td) => {
    return !tokens.some((t) => t.address === td.address)
  })

  // tokensNotInList: call separately to prevent errors from non-erc20 tokens
  // NOTE about err handling: errors are caught for each call in balanceOracle, and we retain the original token entry, which contains the balance
  const calls = paginateArray([...new Set(tokens)], 100).concat(
    paginateArray(tokensNotInList, 100)
  )

  const tokenBalances = (
    await Promise.all(
      calls.map((callTokens) => {
        return getTokenListBalance({ walletAddr, tokens: callTokens, network, updateBalance })
      })
    )
  )
    .flat()
    .filter((t) => {
      return extraTokens.some((et: Token) => t.address === et.address) ? true : t.balanceRaw > 0
    })
  return tokenBalances
}

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
  const [balancesByNetworksLoading, setBalancesByNetworksLoading] = useState<{
    [key in Network]: boolean
  }>({})
  const [otherProtocolsByNetworksLoading, setOtherProtocolsByNetworksLoading] = useState<{
    [key in Network]: boolean
  }>({})

  const [tokensByAccount, setTokensByAccount] = useState({})

  const [tokensByNetworks, setTokensByNetworks] = useState([])
  // Added unsupported networks (fantom and moonbeam) as default values with empty arrays to prevent crashes
  const [otherProtocolsByNetworks, setOtherProtocolsByNetworks] = useState(
    supportedProtocols.filter((item) => !item.protocols || !item.protocols.length)
  )
  const [tokens, setTokens] = useState([])
  const [protocols, setProtocols] = useState([])

  const [collectibles, setCollectibles] = useState([])

  const [cachedBalancesByNetworks, setCachedBalancesByNetworks] = useState([])

  const { extraTokens, getExtraTokensAssets, onAddExtraToken, onRemoveExtraToken } = useExtraTokens({useStorage, useToasts, tokens})
  
  const { balance, otherBalances } = useBalance(tokensByNetworks, currentNetwork)
  const {
fetchSupplementTokenData    } = useFetch(account, currentAccount, currentNetwork, hiddenTokens, getExtraTokensAssets, setTokensByNetworks, getBalances, setOtherProtocolsByNetworks, otherProtocolsByNetworks, addToast, rpcTokensLastUpdated)
  
  // We need to be sure we get the latest balancesByNetworksLoading here
  const areAllNetworksBalancesLoading = useCallback(
    () => Object.values(balancesByNetworksLoading).every((ntwLoading) => ntwLoading),
    [balancesByNetworksLoading]
  )

  const fetchTokens = useCallback(
    // eslint-disable-next-line default-param-last
    async (
      account: string,
      currentNetwork: NetworkId,
      showLoadingState = false,
      tokensByNetworks = []
    ) => {
      // Prevent race conditions
      if (currentAccount.current !== account) return
      console.log('showLoadingState', showLoadingState)
      try {
        const networks = currentNetwork
          ? [supportedProtocols.find(({ network }) => network === currentNetwork)]
          : supportedProtocols

        let failedRequests = 0
        const requestsCount = networks.length
        const updatedTokens = (
          await Promise.all(
            networks.map(async ({ network, balancesProvider }) => {
              // Show loading state only on network change, initial fetch and account change
              if (showLoadingState || !tokensByNetworks.length) {
                console.log('fetchTokens: changing too setLoading curr netw true', tokensByNetworks)

                setBalancesByNetworksLoading((prev) => ({ ...prev, [network]: true }))
                // setTokensByAccount(prev => ({
                //   ...prev,
                //   [`${account}-${network}`]: {
                //     ...prev[`${account}-${network}`],
                //     loading: true
                //   }
                // }))
              }

              try {
                const balance = await getBalances(network, 'tokens', account, balancesProvider)
                if (!balance) return null

                const { meta, products, systemInfo } = Object.values(balance)[0]

                // We should skip the tokens update for the current network,
                // in the case Velcro returns a cached data, which is more outdated than the already fetched RPC data.
                // source 1 means Zapper, 2 means Covalent, 2.1 means Covalent from Velcro cache.
                const isCurrentNetwork = network === currentNetwork
                const shouldSkipUpdate =
                  isCurrentNetwork &&
                  systemInfo.source > 2 &&
                  systemInfo.updateAt < rpcTokensLastUpdated.current

                if (shouldSkipUpdate) return null

                const extraTokensAssets = getExtraTokensAssets(account, network) // Add user added extra token to handle
                let assets = [
                  ...products
                    .map(({ assets }: any) =>
                      assets.map(({ tokens }: any) =>
                        tokens.map((token: any) => ({
                          ...token,
                          // balanceOracle fixes the number to the 10 decimal places, so here we should also fix it
                          balance: Number(token.balance.toFixed(10)),
                          // balanceOracle rounds to the second decimal places, so here we should also round it
                          balanceUSD: roundFloatingNumber(token.balanceUSD)
                        }))
                      )
                    )
                    .flat(2),
                  ...extraTokensAssets
                ]

                const updatedNetwork = network

                // setTokensByAccount(prev => ({
                //   ...prev,
                //   [`${account}-${network}`]: {
                //     ...prev[`${account}-${network}`],
                //     tokens: assets,
                //     loading: false
                //   }
                // }))

                setTokensByNetworks((tokensByNetworks) => [
                  ...tokensByNetworks.filter(({ network }) => network !== updatedNetwork),
                  { network, meta, assets }
                ])

                if (showLoadingState || !tokensByNetworks.length) {
                  setBalancesByNetworksLoading((prev) => ({ ...prev, [network]: false }))
                }

                return {
                  network,
                  meta,
                  assets,
                  systemInfo
                }
              } catch (e) {
                console.error('Balances API error', e)
                failedRequests++
              }
            })
          )
        ).filter((data) => data)

        const outdatedBalancesByNetworks = updatedTokens.filter(
          ({ systemInfo }) => systemInfo.cache
        )

        setCachedBalancesByNetworks(outdatedBalancesByNetworks)

        updatedTokens.map((networkTokens) => {
          return (networkTokens.assets)
        })

        const updatedNetworks = updatedTokens.map(({ network }: any) => network)

        // Prevent race conditions
        if (currentAccount.current !== account) return

        setTokensByNetworks((tokensByNetworks) => [
          ...tokensByNetworks.filter(({ network }) => !updatedNetworks.includes(network)),
          ...updatedTokens
        ])

        if (!currentNetwork) fetchSupplementTokenData(updatedTokens)

        if (failedRequests >= requestsCount) throw new Error('Failed to fetch Tokens from API')
        return true
      } catch (error: any) {
        console.error(error)
        addToast(error.message, { error: true })
        // In case of error set all loading indicators to false
        supportedProtocols.map(
          async (network) =>
            await setBalancesByNetworksLoading((prev) => ({ ...prev, [network]: false }))
        )
        return false
      }
    },
    [fetchSupplementTokenData, getExtraTokensAssets, hiddenTokens, addToast]
  )

  const fetchOtherProtocols = useCallback(
    async (account, currentNetwork = false, otherProtocolsByNetworks) => {
      // Prevent race conditions
      if (currentAccount.current !== account) return

      try {
        const protocols = currentNetwork
          ? [supportedProtocols.find(({ network }) => network === currentNetwork)]
          : supportedProtocols

        let failedRequests = 0
        const requestsCount = protocols.reduce(
          (acc, curr) => (curr && curr.protocols ? curr.protocols?.length : 0) + acc,
          0
        )
        if (requestsCount === 0) return true

        await Promise.all(
          protocols.map(async ({ network, protocols, nftsProvider }) => {
            const all = (
              await Promise.all(
                protocols.map(async (protocol) => {
                  if (!otherProtocolsByNetworks.length) {
                    setOtherProtocolsByNetworksLoading((prev) => ({ ...prev, [network]: true }))
                  }

                  try {
                    const balance = await getBalances(
                      network,
                      protocol,
                      account,
                      protocol === 'nft' ? nftsProvider : null
                    )
                    let response = Object.values(balance)
                      .map(({ products }) => {
                        return products.map(({ label, assets }) => ({
                          label,
                          assets: assets.map(({ tokens }) => tokens).flat(1)
                        }))
                      })
                      .flat(2)
                    response = {
                      network,
                      protocols: [...response]
                    }
                    const updatedNetwork = network

                    setOtherProtocolsByNetworks((protocolsByNetworks) => [
                      ...protocolsByNetworks.filter(({ network }) => network !== updatedNetwork),
                      response
                    ])

                    if (!otherProtocolsByNetworks.length) {
                      setOtherProtocolsByNetworksLoading((prev) => ({ ...prev, [network]: false }))
                    }

                    return balance ? Object.values(balance)[0] : null
                  } catch (e) {
                    console.error('Balances API error', e)
                    failedRequests++
                  }
                })
              )
            )
              .filter((data) => data)
              .flat()

            return all.length
              ? {
                  network,
                  protocols: all
                    .map(({ products }) =>
                      products.map(({ label, assets }) => ({
                        label,
                        assets: assets.map(({ tokens }) => tokens).flat(1)
                      }))
                    )
                    .flat(2)
                }
              : null
          })
        )

        lastOtherProtocolsRefresh = Date.now()
        if (failedRequests >= requestsCount)
          throw new Error('Failed to fetch other Protocols from API')
        return true
      } catch (error) {
        lastOtherProtocolsRefresh = Date.now()
        console.error(error)
        // In case of error set all loading indicators to false
        supportedProtocols.map(
          async (network) =>
            await setOtherProtocolsByNetworksLoading((prev) => ({ ...prev, [network]: false }))
        )
        addToast(error.message, { error: true })

        return false
      }
    },
    [addToast]
  )

  const refreshTokensIfVisible = useCallback(() => {
    if (!account) return
    if (isVisible && !areAllNetworksBalancesLoading()) {
      // Show loading only when switching between networks,
      // since showing it always when tokens are fetched is annoying
      // taking into consideration that refreshing happens automatically
      // on a certain interval or when user window (app) gets back in focus.
      const showLoadingState = prevNetwork !== currentNetwork
      console.log('isVisible', isVisible, 'showLoadingState', showLoadingState, 'prevNetwork', prevNetwork, 'currentNetwork', currentNetwork)
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
    console.log('refresh if hidden', 'isVisible', isVisible, !isVisible && !areAllNetworksBalancesLoading())
    const refreshIfHidden = () =>
      !isVisible && !areAllNetworksBalancesLoading() ? fetchTokens(account, currentNetwork) : null
    const refreshInterval = setInterval(refreshIfHidden, 1500)
    console.log('refreshInterval', refreshInterval)
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
    balancesByNetworksLoading,
    isCurrNetworkBalanceLoading: balancesByNetworksLoading[currentNetwork],
    isCurrNetworkProtocolsLoading: otherProtocolsByNetworksLoading[currentNetwork],
    cachedBalancesByNetworks,
    // updatePortfolio//TODO find a non dirty way to be able to reply to getSafeBalances from the dapps, after the first refresh
  }
}
