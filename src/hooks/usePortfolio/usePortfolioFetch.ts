// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useMemo, useCallback } from 'react'
import supportedProtocols from 'ambire-common/src/constants/supportedProtocols'
import { roundFloatingNumber } from 'ambire-common/src/services/formatter'
import { checkTokenList, getTokenListBalance, tokenList } from 'ambire-common/src/services/balanceOracle'
import { setKnownAddresses, setKnownTokens, token } from '../../services/humanReadableTransactions'

import tokensList from '../../constants/tokenList.json'

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
  pendingTransactions,
  selectedAccount,
  state
}: {
  walletAddr: string
  network: Network
  tokensData: Token[]
  extraTokens: Token[]
  updateBalance?: string
  pendingTransactions: []
  selectedAccount: {}
  state: string
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
        return getTokenListBalance({ walletAddr, tokens: callTokens, network, updateBalance, pendingTransactions, selectedAccount, state })
      })
    )
  )
    .flat()
    .filter((t) => {
      return extraTokens.some((et: Token) => t.address === et.address) ? true : t.balanceRaw > 0
    })
  return tokenBalances
}


// Make humanizer 'learn' about new tokens and aliases
const updateHumanizerData = (_tokensList) => {
  const knownAliases = _tokensList.map(({ address, symbol }) => ({ address, name: symbol }))
  setKnownAddresses(knownAliases)
  setKnownTokens(_tokensList)
}

// All fetching logic required in our portfolio.
export default function useProtocolsFetch({
  account,
  currentAccount,
  currentNetwork,
  hiddenTokens,
  getExtraTokensAssets,
  getBalances,
  addToast,
  setAssetsByAccount,
  getCoingeckoPrices,
  setPricesFetching,
  filterByHiddenTokens,
  extraTokens,
  pendingTransactions,
  eligibleRequests,
  selectedAccount
}) {
  const extraTokensAssets = useMemo(
    () => getExtraTokensAssets(account, currentNetwork),
    [account, extraTokens, currentNetwork]
  )

  const fetchAndSetSupplementTokenData = async (assets) => {
    await new Promise((resolve) => fetchAllSupplementTokenData(assets, resolve))
    .then(oracleResponse => {
      setAssetsByAccount(prev => ({
        ...prev,
        [`${account}-${currentNetwork}`]: {
          ...prev[`${account}-${currentNetwork}`],
          tokens: oracleResponse,
          loading: false
        }
      }))
    })
  }

  const updateCoingeckoAndSupplementData = async (assets) => {
    const tokens = assets?.tokens || []
    // Check for not updated prices from coingecko
    const coingeckoTokensToUpdate = tokens.filter(token => token.coingeckoId).some(token => { 
      if (((new Date().valueOf() - token.priceUpdate) >= 2*60*1000)) {
        return token
      }
    })

    // Update prices from coingecko and balance from balance oracle
    if (coingeckoTokensToUpdate) {
      const coingeckoPrices = new Promise((resolve, reject) => fetchCoingeckoPrices( tokens, resolve))
      const balanceOracle = new Promise(( resolve, reject) => fetchAllSupplementTokenData({ tokens: tokens }, resolve))

      Promise.all([coingeckoPrices, balanceOracle]).then((results) => {
        const coingeckoResponse = results[0]
        const balanceOracleResponse = results[1]

        const updatedBalance = balanceOracleResponse.map(t => {
          if (coingeckoResponse.hasOwnProperty(t.coingeckoId)) {
            return {
              ...t,
              price: coingeckoResponse[t.coingeckoId].usd,
              balanceUSD: Number(parseFloat(t.balance * coingeckoResponse[t.coingeckoId].usd || 0).toFixed(2)),
              priceUpdate: new Date().valueOf()
            }
          } else return t
        })            

        updateHumanizerData(updatedBalance)

        setAssetsByAccount(prev => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            tokens: updatedBalance,
          }
        }))
      
      })  
    } else {
      // Update only balance from balance oracle
      new Promise((resolve) => {
        fetchAllSupplementTokenData({ tokens: tokens }, resolve)
      }).then(oracleResponse => {
        updateHumanizerData(oracleResponse)
        setAssetsByAccount(prev => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            tokens: oracleResponse,
            loading: false
          }
        }))
      }) 
    }
  }
  
  const fetchCoingeckoPrices = useCallback(async(tokens, resolve) => {
    const coingeckoTokensToUpdate = tokens?.filter(token => token.coingeckoId).filter(token => { 
      if (((new Date().valueOf() - token.priceUpdate ) >= 2*60*1000)) {
        return token
      }
    }).map(token => token.coingeckoId)
    if (!coingeckoTokensToUpdate.length) return null

    setPricesFetching(true)
    try {
      const response = await getCoingeckoPrices(coingeckoTokensToUpdate.join(','))
      if (!response) return null
      resolve && resolve(response)
      setPricesFetching(false)

    } catch (e) {
      addToast(e.message, { error: true })
      setPricesFetching(false)
      resolve && resolve([])

      setAssetsByAccount(prev => ({ ...prev, loading: false }))
    }
  }, [account, currentNetwork])

  const fetchOtherNetworksBalances = useCallback(async (account) => {
    const networksToFetch = supportedProtocols.filter(({ network }) => network !== currentNetwork)

    try {
      Promise.all(
        networksToFetch.map(async ({ network, balancesProvider }) => {
          setAssetsByAccount(prev => ({
            ...prev,
            [`${account}-${network}`]: {
              ...prev[`${account}-${network}`],
              loading: true
            }
          }))

          const response = await getBalances(network, account, balancesProvider)

          if (!response) return null

          const { tokens, nfts } = response.data

          let formattedTokens = [
            ...tokens
              .map((token: any) => ({
                  ...token,
                  // balanceOracle fixes the number to the 10 decimal places, so here we should also fix it
                  balance: Number(token.balance.toFixed(10)),
                  // balanceOracle rounds to the second decimal places, so here we should also round it
                  balanceUSD: roundFloatingNumber(token.balanceUSD),
                  price: token.price || null,
                  network: network
              }))
              .filter((token: any) => !!token.name && !!token.symbol),
          ]

          formattedTokens = filterByHiddenTokens(formattedTokens)

          setAssetsByAccount(prev => ({
            ...prev,
            [`${account}-${network}`]: {
              ...prev[`${account}-${network}`],
              tokens: formattedTokens,
              collectibles: nfts,
              loading: false,
              network: network
            }
          }))
        
        })
      )

    } catch (e) {
      addToast(e.message, { error: true })

      setAssetsByAccount(prev => ({
        ...prev,
        [`${account}-${network}`]: {
          ...prev[`${account}-${network}`],
          loading: false
        }
    }))
    }
  }, [account, currentNetwork])

  const removeDuplicatedAssets = (tokens) => {
    const lookup = tokens.reduce((a, e) => {
      a[e.address] = ++a[e.address] || 0
      return a
    }, {})

    // filters by non duplicated objects or takes the one of dup but with a price greater than 0
    tokens = tokens.filter((e) => !lookup[e.address] || (lookup[e.address] && e.price))

    return tokens
  }

  const fetchAllSupplementTokenData = useCallback(
    async (updatedTokens: any[], _resolve) => {         
      const tokenList = removeDuplicatedAssets([
        ...tokensList[currentNetwork],
        ...updatedTokens?.tokens
      ])
      
      const unconfirmedRequests = eligibleRequests.map(t => ({ ...t, txns: [t.txn.to, t.txn.value, t.txn.data] }) ).map(t => t.txns)
    
      // 1. Fetch Latest
      const balanceOracleLatest = new Promise((resolve, reject) => fetchSupplementTokenData({ tokens: updatedTokens?.tokens }, resolve, [], 'latest'))
      // 2. Fetch Pending
      const balanceOraclePending = pendingTransactions?.length && new Promise((resolve, reject) => fetchSupplementTokenData({ tokens: tokenList }, resolve, [], 'pending'))
      // TODO: Parse eligibleRequests transactions with humanizer to check for swap and pass the two tokens to balance oracle
      // 3. Fetch Unconfirmed
      const balanceOracleUnconfirmed =  unconfirmedRequests?.length  && new Promise((resolve, reject) => fetchSupplementTokenData({ tokens: tokenList }, resolve, unconfirmedRequests, 'unconfirmed'))

      const promises = [
        balanceOracleLatest,
        pendingTransactions?.length ? balanceOraclePending : null,
        unconfirmedRequests?.length ? balanceOracleUnconfirmed : null
      ]
  
      Promise.all([...promises]).then((results) => {
        const latest = results[0]
        const pending = results[1]
        const unconfirmed = results[2]

        const response = latest.map((t, i) => ({
          ...t,
          ...pending && { ['pending']: pending[i] },
          ...unconfirmed && { ['unconfirmed']: unconfirmed[i] },
        }))

        _resolve && _resolve(response)
      
      })
    },
    [currentNetwork, account, extraTokensAssets, hiddenTokens, pendingTransactions, eligibleRequests]
  )

  const fetchSupplementTokenData = useCallback(
    async (updatedTokens: any[], resolve, pendingTransactions = [], state = 'latest') => {   
      if (!updatedTokens?.tokens?.length) {
        setAssetsByAccount(prev => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            loading: true
          }
        }))
      }

      try {
        let rcpTokenData = await supplementTokensDataFromNetwork({
          walletAddr: account,
          network: currentNetwork,
          tokensData: updatedTokens?.tokens?.length
            ? updatedTokens.tokens.filter(
                ({ isExtraToken }: { isExtraToken: boolean }) => !isExtraToken
              )
            : [], // Filter out extraTokens
          extraTokens: extraTokensAssets,
          hiddenTokens,
          pendingTransactions: pendingTransactions,
          selectedAccount,
          state
        })    

        resolve && resolve(rcpTokenData)
      } catch (e) {
        console.error('supplementTokensDataFromNetwork failed', e)
        resolve([])
        // In case of error set loading indicator to false
        setAssetsByAccount(prev => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            loading: false,
            error: e.message
          }
        }))
      }
    },
    [currentNetwork, account, extraTokensAssets, hiddenTokens, selectedAccount]
  )
  
  // Full update of tokens
  const fetchTokens = useCallback(
    // eslint-disable-next-line default-param-last
    async (
      account: string,
      currentNetwork: NetworkId,
      showLoadingState = false,
      assets = []
    ) => {
      // Prevent race conditions
      if (currentAccount.current !== account) return
    
      if (showLoadingState || !assets?.tokens?.length) {
        setAssetsByAccount(prev => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            loading: true,
          }
        }))
      }

      const network = supportedProtocols.find(({ network }) => network === currentNetwork)
      
      try {
        const quickResponse = !assets?.tokens?.length
        const response = await getBalances(currentNetwork, account, network.balancesProvider, quickResponse)
        if (!response) return null

        let { cache, cacheTime, tokens, nfts, partial, error, provider } = response.data

        tokens = filterByHiddenTokens(tokens)
        const prevCacheTime = assets?.cacheTime
        // provider = "balanceOracle"
        // We should skip the tokens update for the current network,
        // in the case Velcro returns a cached data, which is more outdated than the already fetched data.
        const shouldSkipUpdate =
          cache &&
          (new Date(cacheTime) < new Date(prevCacheTime)) || partial

        cache = shouldSkipUpdate || false
        let formattedTokens = [...tokens]

        // velcro provider is balanceOracle and tokens may not be full
        // repopulate with current tokens and pass them to balanceOracle
        if (provider === 'balanceOracle') {
          formattedTokens = [
            ...assets?.tokens || [],
            ...formattedTokens,
          ]
        }

        // In case we have cached data from covalent - call balance oracle
        if (shouldSkipUpdate) {
          // Update only balance from balance oracle
          fetchAndSetSupplementTokenData({ tokens: formattedTokens })
          return 
        }

        formattedTokens = [
          ...tokens
            .map((token: any) => ({
              ...token,
              // balanceOracle fixes the number to the 10 decimal places, so here we should also fix it
              balance: Number(token.balance.toFixed(10)),
              // balanceOracle rounds to the second decimal places, so here we should also round it
              balanceUSD: roundFloatingNumber(token.balanceUSD),
              price: token.price || null,
              network: network?.network
            }))
            .filter((token: any) => !!token.name && !!token.symbol),
          ...extraTokensAssets
        ]

        // Set the new data from velcro if we don't have any tokens yet
        // this can happen on first data update and we need to set our state
        // so the user doesnt wait too long seeing the loading state
        if (!assets?.tokens?.length) {
          setAssetsByAccount(prev => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              tokens: formattedTokens,
              collectibles: nfts,
              cache: cache || false,
              cacheTime: cacheTime || new Date().valueOf(),
              loading: false
            }
          }))
        } else {
          // Otherwise wait for balance Oracle to set our tokens in state,
          // but still there is a need to update the loading state and other data.
          setAssetsByAccount(prev => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              collectibles: nfts,
              cache: cache || false,
              cacheTime: cacheTime || new Date().valueOf(),
              loading: false
            }
          }))
        }

        updateCoingeckoAndSupplementData({ tokens: formattedTokens })
        
        // Show error in case we have some
        // if (error) addToast(error, { error: true })
        
      } catch (e) {
        console.error('Balances API error', e)
        addToast(e.message, { error: true })

        setAssetsByAccount(prev => ({
            ...prev,
            [`${account}-${network}`]: {
              ...prev[`${account}-${network}`],
              error: e,
              loading: false
            }
        }))
      }
      
    },
    [fetchSupplementTokenData, hiddenTokens, extraTokensAssets, addToast]
  )

  return {
    fetchTokens,
    fetchSupplementTokenData,
    fetchOtherNetworksBalances,
    fetchCoingeckoPrices,
    fetchAndSetSupplementTokenData,
    updateCoingeckoAndSupplementData,
    fetchAllSupplementTokenData
  }
}
