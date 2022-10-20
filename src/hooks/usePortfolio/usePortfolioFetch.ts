// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useMemo, useCallback } from 'react'
import supportedProtocols from 'ambire-common/src/constants/supportedProtocols'
import networks from 'ambire-common/src/constants/networks'

import { roundFloatingNumber } from 'ambire-common/src/services/formatter'
import { checkTokenList, getTokenListBalance } from 'ambire-common/src/services/balanceOracle'
import { setKnownAddresses, setKnownTokens } from '../../services/humanReadableTransactions'
import { getTransactionSummary } from '../../services/humanReadableTransactions/transactionSummary' 
import { toBundleTxn } from 'ambire-common/src/services/requestToBundleTxn'
import { ConstantsType } from '../useConstants'
import { Token, Network } from './types'

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

const removeDuplicatedAssets = (tokens) => {
  const lookup = tokens.reduce((a, e) => {
    a[e.address] = ++a[e.address] || 0
    return a
  }, {})

  // filters by non duplicated objects or takes the one of dup but with a price greater than 0
  tokens = tokens.filter((e) => !lookup[e.address] || (lookup[e.address] && e.price))

  return tokens
}

async function supplementTokensDataFromNetwork({
  tokenList = {},
  walletAddr,
  network,
  tokensData,
  extraTokens,
  updateBalance,
  pendingTransactions,
  selectedAccount,
  state
}: {
  tokenList: ConstantsType['tokenList']
  walletAddr: string
  network: Network
  tokensData: Token[]
  extraTokens: Token[]
  updateBalance?: (token: Token | {}) => any
  pendingTransactions: []
  selectedAccount: {}
  state: string
}) {
  if (!walletAddr || walletAddr === '' || !network) return []
  // eslint-disable-next-line no-param-reassign
  if (!tokensData || !tokensData[0]) tokensData = checkTokenList(tokensData || []) // tokensData check and populate for test if undefind
  // eslint-disable-next-line no-param-reassign
  if (!extraTokens || !extraTokens[0]) extraTokens = checkTokenList(extraTokens || []) // extraTokens check and populate for test if undefind

  function getNativeAsset(){
    const net = networks.find(({id}) => id === network)
    return net && net.nativeAsset ? [net.nativeAsset] : []
  }

  // concat predefined token list with extraTokens list (extraTokens are certainly ERC20)
  const fullTokenList = [
    // @ts-ignore figure out how to add types for the `tokenList`
    ...new Set(tokenList[network] ? tokenList[network].concat(extraTokens) : [...extraTokens, ...getNativeAsset(extraTokens)])
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
  return { tokens: tokenBalances, state }
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
  getCoingeckoPriceByContract,
  getCoingeckoAssetPlatforms,
  filterByHiddenTokens,
  extraTokens,
  pendingTransactions,
  eligibleRequests,
  selectedAccount,
  constants
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

  const updateCoingeckoAndSupplementData = useCallback(async (assets) => {
    const tokens = assets?.tokens || []
    // Check for not updated prices from coingecko
    const coingeckoTokensToUpdate = tokens.filter(token => token.coingeckoId).some(token => { 
      if (((new Date().valueOf() - token.priceUpdate) >= 2*60*1000)) {
        return token
      }
    })

    // Update prices from coingecko and balance from balance oracle
    if (coingeckoTokensToUpdate) {
      const coingeckoPrices = new Promise((resolve) => fetchCoingeckoPrices( tokens, resolve))
      const balanceOracle = new Promise((resolve) => fetchAllSupplementTokenData({ tokens: tokens }, resolve))

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

        updatedBalance.length && updateHumanizerData(updatedBalance)

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
        oracleResponse.length && updateHumanizerData(oracleResponse)
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
  }, [pendingTransactions, eligibleRequests])
  
  const fetchCoingeckoPrices = useCallback(async(tokens, resolve) => {
    const coingeckoTokensToUpdate = tokens?.filter(token => token.coingeckoId).filter(token => { 
      if (((new Date().valueOf() - token.priceUpdate ) >= 2*60*1000)) {
        return token
      }
    }).map(token => token.coingeckoId)
    if (!coingeckoTokensToUpdate.length) return null

    try {
      const response = await getCoingeckoPrices(coingeckoTokensToUpdate.join(','))
      if (!response) return null
      resolve && resolve(response)

    } catch (e) {
      addToast(e.message, { error: true })
      resolve && resolve([])

      setAssetsByAccount(prev => ({ ...prev, loading: false }))
    }
  }, [account, currentNetwork])

  const fetchCoingeckoAsset = async () => {
    const network = networks.find(({ id }) => id === currentNetwork)
    try {
      const response = await getCoingeckoAssetPlatforms()
      if (!response) return null
      const current = response.find(ntw => ntw.chain_identifier === network?.chainId)
      return current?.id
    } catch (e) {
      addToast(e.message, { error: true })
    }
  }

  const fetchCoingeckoPricesByContractAddress = useCallback(async(tokens, resolve) => {
    const assetPlatform = await fetchCoingeckoAsset()
    const coingeckoTokensToUpdate = tokens.map(token => token.address)
    try {
      Promise.all(coingeckoTokensToUpdate.map(async (addr) => {
        const response = await getCoingeckoPriceByContract(assetPlatform, addr)
        if (!response) return null
        return {
          address: response?.platforms[assetPlatform],
          tokenImageUrls: response?.image,
          tokenImageUrl: response?.image?.small,
          symbol: response?.symbol.toUpperCase(),
          price: response?.market_data.current_price.usd,
          isHidden: false,
        }
      })).then(res => resolve({ tokens: res, state: 'coingecko' }))
    } catch (e) {
      resolve && resolve({ tokens: {}, state: 'coingecko' })
    }
  }, [account, currentNetwork])

  const fetchOtherNetworksBalances = useCallback(async (account) => {
    const networksToFetch = supportedProtocols.filter(({ network }) => network !== currentNetwork).filter(({ network }) => !networks.find(({id}) => id === network)?.relayerlessOnly)
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

          const { tokens = [], nfts } = response.data

          let formattedTokens = [
            ...tokens.map((token: any) => ({
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

  const fetchAllSupplementTokenData = useCallback(
    async (updatedTokens: any[], _resolve) => { 
     
      console.log('eligibleRequests', eligibleRequests, pendingTransactions)
      const unsignedRequests = eligibleRequests.map(t => ({ ...t, txns: [t.txn.to, t.txn.value, t.txn.data] }) ).map(t => t.txns)

      const extendedSummary = eligibleRequests?.length && eligibleRequests.map(req => {
        const txn = toBundleTxn(req.txn, account)
        return getTransactionSummary(constants.humanizerInfo, txn, currentNetwork, account, { extended: true })
      }).flat()

      let tokensList = removeDuplicatedAssets([
        ...constants?.tokenList[currentNetwork],
        ...(updatedTokens && updatedTokens.tokens?.length && updatedTokens.tokens || [])
      ])

      const tokensToFetchPrices = []
      // Check if not signed request contains tokens from swap which arent in portfolio yet
      extendedSummary.length && extendedSummary.map(s => {
        if (s[0] === 'Swap') {
          s.map((el) => {
            if (el?.type === 'token') {
              const isInPortfolio = updatedTokens?.tokens?.find(token => token.address === el.address)
              if (!isInPortfolio || !isInPortfolio.price) {
                tokensToFetchPrices.push(el)
                tokensList.push({ ...el, balance: 0 })
              }
            }
          })
        }
      })

      // Only tokens which should be fetched with the latest state
      // In the case we have unconfirmed values and pending values, but no latest => this means user didnt have this token originally.
      // In the case we dont have nor latest, nor unconfirmed, nor pending => this is first fetch from balance oracle
      const latestTokens = tokensToFetchPrices.length ? updatedTokens?.tokens
      .filter(t => t.address.toLowerCase() !== tokensToFetchPrices.find((tk) => tk.address.toLowerCase() === t.address.toLowerCase()) && (((t.unconfirmed || t.pending) && !t.latest) || (!t.latest && (!t.unconfirmed || !t.pending)))) : updatedTokens?.tokens
      console.log('tokensToFetchPrices', tokensToFetchPrices, 'latestTokens', latestTokens)

      // Remove unconfirmed and pending tokens from latest request.
      // 1. Fetch latest balance data from balanceOracle
      const balanceOracleLatest = new Promise((resolve) => fetchSupplementTokenData({ tokens: latestTokens }, resolve, [], 'latest'))

      // 2. Fetch pending balance data from balanceOracle
      const balanceOraclePending = pendingTransactions?.length && new Promise((resolve) => fetchSupplementTokenData({ tokens: tokensList }, resolve, [], 'pending'))

      // 3. Fetching of unconfirmed/unsigned token data from balanceOracle
      const balanceOracleUnconfirmed = unsignedRequests?.length  && new Promise((resolve) => fetchSupplementTokenData({ tokens: tokensList }, resolve, unsignedRequests, 'unconfirmed'))
      // Fetch coingecko prices for newly acquired tokens from swap transaction 
      const coingeckoPrices = tokensToFetchPrices?.length && new Promise((resolve, reject) => fetchCoingeckoPricesByContractAddress(tokensToFetchPrices, resolve))
      
      const promises = [
        balanceOracleLatest,
        pendingTransactions?.length ? balanceOraclePending : [],
        unsignedRequests?.length ? balanceOracleUnconfirmed : [],
        tokensToFetchPrices?.length ? coingeckoPrices : []
      ]

      Promise.all([...promises]).then(results => {
        // Fetched prices from coingecko
        const prices = results && results.length && results.find(el => el.state === 'coingecko') 
        if (prices) results.pop()
        
        const latestResponse = results.find(({ state }) => state === 'latest')
        // Remove empty array for not send promises
        const res = results.flat()

        const response = res.map(_res => {
          return _res && _res.tokens && _res.tokens.length && _res.tokens.map((_t: Token, i) => {
            const priceUpdate = prices && prices?.tokens?.length && prices.tokens.find(pt => pt.address.toLowerCase() === _t.address.toLowerCase())

            const { unconfirmed, latest, pending, ...newToken } = _t
            const latestBalance = latestResponse?.tokens?.find(token => token.address === _t.address)

            return {
            ...newToken,
            network: currentNetwork,
            ...(priceUpdate ? {
              ...priceUpdate,
              balanceUSD: Number(parseFloat(_t.balance * priceUpdate.price || 0).toFixed(2))
            } : {}),
            ...(latestBalance && {['latest']: { balanceUSD: latestBalance.balanceUSD, balance: latestBalance.balance}}),
            ...((latestBalance?.balance !== _t.balance || !latestBalance) && {
              [_res.state]: {
                balanceUSD: priceUpdate ? Number(parseFloat(_t.balance * priceUpdate.price || 0).toFixed(2)) : _t.balanceUSD,
                balance: _t.balance,
              }}
            )
          }})
        })[res.length - 1] || []
        console.log(res, response)
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
          tokenList: constants?.tokenList,
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
    [currentNetwork, account, extraTokensAssets, hiddenTokens, selectedAccount, eligibleRequests]
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
    [fetchSupplementTokenData, hiddenTokens, extraTokensAssets, addToast, eligibleRequests]
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
