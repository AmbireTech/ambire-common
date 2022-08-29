// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useMemo, useCallback } from 'react'
import supportedProtocols from 'ambire-common/src/constants/supportedProtocols'
import { roundFloatingNumber } from 'ambire-common/src/services/formatter'
import { checkTokenList, getTokenListBalance, tokenList } from 'ambire-common/src/services/balanceOracle'
import { setKnownAddresses, setKnownTokens } from '../../services/humanReadableTransactions'

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


// Make humanizer 'learn' about new tokens and aliases
const updateHumanizerData = (tokensList) => {
  const knownAliases = tokensList.map(({ address, symbol }) => ({ address, name: symbol }))
  setKnownAddresses(knownAliases)
  setKnownTokens(tokensList)
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
  rpcTokensLastUpdated,
  setBalances,
  setAssetsByAccount,
  getOtherNetworksTotals,
  getCoingeckoPrices
}) {
  const extraTokensAssets = useMemo(
    () => getExtraTokensAssets(account, currentNetwork),
    [account, currentNetwork]
  )
    
  const fetchCoingeckoPrices = useCallback(async(velcroResponse) => {
    const { tokens } = velcroResponse
    const coingeckoTokensToUpdate = tokens?.filter(token => token.coingeckoId).filter(token => { 
      if (((new Date().valueOf() - token.priceUpdate ) >= 2*60*1000)) {
        return token
      }
    }).map(token => token.coingeckoId)

    if (!coingeckoTokensToUpdate.length) return null
    try {
      const response = await getCoingeckoPrices(coingeckoTokensToUpdate.join(','))
      if (!response) return null

      const tokensWithNewPrices = tokens.map(token => {
        if (response.hasOwnProperty(token.coingeckoId)) {
          return {
            ...token,
            price: response[token.coingeckoId].usd,
            balanceUSD: parseFloat(token.balance * response[token.coingeckoId].usd),
          }
        } else return token
      })  
      
      setAssetsByAccount(prev => ({
        ...prev,
        [`${account}-${currentNetwork}`]: {
          ...prev[`${account}-${currentNetwork}`],
          ...velcroResponse,
          tokens: tokensWithNewPrices,
          collectibles: velcroResponse.nfts,
          loading: false,
          priceUpdate: new Date().valueOf()
        }
      }))

    } catch (e) {
      addToast(e.message, { error: true })
      setBalances(prev => ({ ...prev, loading: false }))
    }
  }, [account, currentNetwork])

  const fetchOtherNetworksBalances = useCallback(async (account, currentNetwork) => {
    const network = supportedProtocols.find(({ network }) => network === currentNetwork)

    setBalances(prev => ({ ...prev, loading: true }))
    
    try {
      const response = await getOtherNetworksTotals(currentNetwork, account, network.balancesProvider)
      if (!response) return null

      setBalances(prev => ({ ...prev, loading: false, data: response.data }))
    } catch (e) {
      addToast(e.message, { error: true })
      setBalances(prev => ({ ...prev, loading: false }))
    }
  }, [currentNetwork])

  const fetchSupplementTokenData = useCallback(
    async (updatedTokens: any[]) => {      
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
          hiddenTokens
        })        

        setAssetsByAccount(prev => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            tokens: rcpTokenData,
            loading: false
          }
        }))

        rpcTokensLastUpdated.current = Date.now()
      } catch (e) {
        console.error('supplementTokensDataFromNetwork failed', e)
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
    [currentNetwork, account, extraTokensAssets, hiddenTokens]
  )

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
        const response = await getBalances(currentNetwork, account, network.balancesProvider)
        if (!response) return null

        const { cache, cacheTime, tokens, nfts, error } = response.data

        // We should skip the tokens update for the current network,
        // in the case Velcro returns a cached data, which is more outdated than the already fetched RPC data.
        const shouldSkipUpdate =
          cache &&
          cacheTime < rpcTokensLastUpdated.current

        if (shouldSkipUpdate) {
          if (showLoadingState || !assets?.tokens?.length) {
            setAssetsByAccount(prev => ({
              ...prev,
              [`${account}-${currentNetwork}`]: {
                ...prev[`${account}-${currentNetwork}`],
                loading: false
              }
            }))
          } else return null
        }
        
        let formattedTokens = [
          ...tokens
            .map((token: any) => ({
                  ...token,
                  // balanceOracle fixes the number to the 10 decimal places, so here we should also fix it
                  balance: Number(token.balance.toFixed(10)),
                  // balanceOracle rounds to the second decimal places, so here we should also round it
                  balanceUSD: roundFloatingNumber(token.balanceUSD),
                  price: token.price || null
                })),
          ...extraTokensAssets
        ]

        const coingeckoTokensToUpdate = tokens.filter(token => token.coingeckoId).some(token => { 
          if (((new Date().valueOf() - token.priceUpdate) >= 2*60*1000)) {
            return token
          }
        })

        if (coingeckoTokensToUpdate)  {
          fetchCoingeckoPrices({ ...response.data, tokens: formattedTokens }) }
        else {
          setAssetsByAccount(prev => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              tokens: formattedTokens,
              collectibles: nfts,
              cache,
              cacheTime,
              loading: false
            }
          }))
        }


        // Show error in case we have some
        // if (error) addToast(error, { error: true })
        
        updateHumanizerData(formattedTokens)

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
    fetchOtherNetworksBalances
  }
}
