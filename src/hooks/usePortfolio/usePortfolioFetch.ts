// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useMemo, useCallback } from 'react'
import supportedProtocols from 'ambire-common/src/constants/supportedProtocols'
import { roundFloatingNumber } from 'ambire-common/src/services/formatter'
import { checkTokenList, getTokenListBalance, tokenList } from 'ambire-common/src/services/balanceOracle'

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
  updateBalance
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
  const calls = paginateArray([...new Set(tokens)], 100).concat(paginateArray(tokensNotInList, 100))

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

// All fetching logic required in our portfolio.
// TODO: In the future we need to:
// 1. Fetch coingecko prices and populate assets
// 2. Implement one more request - fetching current balances on the other networks.
// 3. Implement relayerless mode fetching mechanism here
export default function useProtocolsFetch({
  account,
  currentAccount,
  currentNetwork,
  hiddenTokens,
  getExtraTokensAssets,
  setTokensByNetworks,
  setOtherProtocolsByNetworks,
  getBalances,
  addToast,
  rpcTokensLastUpdated,
  setBalancesByNetworksLoading,
  setAssetsByAccount,
  setOtherProtocolsByNetworksLoading,
  setCachedBalancesByNetworks
}) {
  const extraTokensAssets = useMemo(
    () => getExtraTokensAssets(account, currentNetwork),
    [account, currentNetwork]
  )

  const fetchSupplementTokenData = useCallback(
    async (updatedTokens: any[]) => {
      const currentNetworkTokens = updatedTokens.find(
        ({ network }: Token) => network === currentNetwork
      ) || { network: currentNetwork, meta: [], assets: [] }

      if (!updatedTokens.length) {
        setBalancesByNetworksLoading((prev) => ({ ...prev, [currentNetwork]: true }))

        // setAssetsByAccount(prev => ({
        //   ...prev,
        //   [`${account}-${currentNetwork}`]: {
        //     ...prev[`${account}-${currentNetwork}`],
        //     loading: true
        //   }
        // }))
      }

      try {
        const rcpTokenData = await supplementTokensDataFromNetwork({
          walletAddr: account,
          network: currentNetwork,
          tokensData: currentNetworkTokens
            ? currentNetworkTokens.assets.filter(
                ({ isExtraToken }: { isExtraToken: boolean }) => !isExtraToken
              )
            : [], // Filter out extraTokens
          extraTokens: extraTokensAssets,
          hiddenTokens
        })

        currentNetworkTokens.assets = rcpTokenData

        setTokensByNetworks((tokensByNetworks) => [
          ...tokensByNetworks.filter(({ network }) => network !== currentNetwork),
          currentNetworkTokens
        ])

        // setAssetsByAccount(prev => ({
        //   ...prev,
        //   [`${account}-${currentNetwork}`]: {
        //     ...prev[`${account}-${currentNetwork}`],
        //     tokens: currentNetworkTokens,
        //     loading: true
        //   }
        // }))

        if (!updatedTokens.length) {
          setBalancesByNetworksLoading((prev) => ({ ...prev, [currentNetwork]: false }))
          // setAssetsByAccount(prev => ({
          //   ...prev,
          //   [`${account}-${currentNetwork}`]: {
          //     ...prev[`${account}-${currentNetwork}`],
          //     loading: false
          //   }
          // }))
        }

        rpcTokensLastUpdated.current = Date.now()
      } catch (e) {
        console.error('supplementTokensDataFromNetwork failed', e)
        // In case of error set loading indicator to false
        setBalancesByNetworksLoading((prev) => ({ ...prev, [currentNetwork]: false }))
      }
    },
    [currentNetwork, account, extraTokensAssets, hiddenTokens]
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
                setBalancesByNetworksLoading((prev) => ({ ...prev, [network]: true }))
                // setAssetsByAccount(prev => ({
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

                // setAssetsByAccount(prev => ({
                //   ...prev,
                //   [`${account}-${network}`]: {
                //     ...prev[`${account}-${network}`],
                //     tokens: assets,
                //     systemInfo,
                //     error: {},
                //     loading: false
                //   }
                // }))

                setTokensByNetworks((tokensByNetworks) => [
                  ...tokensByNetworks.filter(({ network }) => network !== updatedNetwork),
                  { network, meta, assets }
                ])

                if (showLoadingState || !tokensByNetworks.length) {
                  setBalancesByNetworksLoading((prev) => ({ ...prev, [network]: false }))
                  // setAssetsByAccount(prev => ({
                  //   ...prev,
                  //   [`${account}-${network}`]: {
                  //     ...prev[`${account}-${network}`],
                  //     loading: false
                  //   }
                  // }))
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

        // TODO: Not needed to set in separate state. We can save this in the future in state with our assets
        const outdatedBalancesByNetworks = updatedTokens.filter(
          ({ systemInfo }) => systemInfo.cache
        )

        setCachedBalancesByNetworks(outdatedBalancesByNetworks)

        updatedTokens.map((networkTokens) => {
          return networkTokens.assets
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
          // setAssetsByAccount(prev => ({
          //   ...prev,
          //   [`${account}-${network}`]: {
          //     ...prev[`${account}-${network}`],
          //     loading: false, 
          //     systemInfo: {},
          //     error: error
          //   }
          // }))
            await setBalancesByNetworksLoading((prev) => ({ ...prev, [network]: false }))
        )
        return false
      }
    },
    [fetchSupplementTokenData, hiddenTokens, extraTokensAssets, addToast]
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

        if (failedRequests >= requestsCount)
          throw new Error('Failed to fetch other Protocols from API')
        return true
      } catch (error) {
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
  return {
    fetchTokens,
    fetchOtherProtocols,
    fetchSupplementTokenData
  }
}
