/* eslint-disable import/extensions */
// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { Contract } from 'ethers'

import networks from '../../../constants/networks'
import { getProvider } from '../../../services/provider'
import { getTransactionSummary } from '../../../services/humanReadableTransactions/transactionSummary'
import { toBundleTxn } from '../../../services/requestToBundleTxn'
import { ConstantsType } from '../../hooks/useConstants'
import { Token, Network } from '../hooks/usePortfolio/types'

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
  tokenList = {},
  walletAddr,
  network,
  tokensData,
  extraTokens,
  updateBalance,
  pendingTransactions,
  selectedAccount,
  state,
  getTokenListBalance,
  checkTokenList
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

  function getNativeAsset() {
    const net = networks.find(({ id }) => id === network)
    return net && net.nativeAsset ? [net.nativeAsset] : []
  }

  // concat predefined token list with extraTokens list (extraTokens are certainly ERC20)
  const fullTokenList = [
    // @ts-ignore figure out how to add types for the `tokenList`
    ...new Set(
      tokenList[network]
        ? tokenList[network].concat(extraTokens)
        : [...extraTokens, ...getNativeAsset(extraTokens)]
    )
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
        return getTokenListBalance({
          walletAddr,
          tokens: callTokens,
          network,
          updateBalance,
          pendingTransactions,
          selectedAccount,
          state
        })
      })
    )
  )
    .flat()
    .filter((t) => {
      if (extraTokens.some((et: Token) => t.address === et.address)) {
        return true
      }
      if (state === 'latest') {
        return !!(tokensData.find((token) => t.address === token.address) || t.balanceRaw > 0)
      }
      return true
    })
  return { tokens: tokenBalances, state }
}

// Make humanizer 'learn' about new tokens and aliases
const updateHumanizerData = (_tokensList: Token[], setKnownAddresses, setKnownTokens) => {
  const knownAliases = _tokensList.map(({ address, symbol }) => ({ address, name: symbol }))
  setKnownAddresses(knownAliases)
  setKnownTokens(_tokensList)
}

export default function useBalanceOracleFetch({
  account,
  selectedAccount,
  currentNetwork,
  setAssetsByAccount,
  eligibleRequests,
  pendingTransactions,
  extraTokensAssets,
  hiddenTokens,
  constants,
  fetchCoingeckoPricesByContractAddress,
  fetchCoingeckoPrices,
  fetchingAssets,
  setFetchingAssets,
  removeDuplicatedAssets,
  setKnownAddresses,
  setKnownTokens,
  getTokenListBalance,
  checkTokenList
}) {
  const fetchSupplementTokenData = async (
    updatedTokens: any,
    resolve,
    reject,
    _pendingTransactions = [],
    state = 'latest'
  ) => {
    if (!updatedTokens?.tokens?.length) {
      setAssetsByAccount((prev) => ({
        ...prev,
        [`${account}-${currentNetwork}`]: {
          ...prev[`${account}-${currentNetwork}`],
          loading: true
        }
      }))
    }

    try {
      const rcpTokenData = await supplementTokensDataFromNetwork({
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
        pendingTransactions: _pendingTransactions,
        selectedAccount,
        state,
        removeDuplicatedAssets,
        setKnownAddresses,
        getTokenListBalance,
        checkTokenList
      })

      resolve && resolve(rcpTokenData)
    } catch (e) {
      console.error('supplementTokensDataFromNetwork failed', e)
      // In case of error set loading indicator to false
      setAssetsByAccount((prev) => ({
        ...prev,
        [`${account}-${currentNetwork}`]: {
          ...prev[`${account}-${currentNetwork}`],
          loading: false,
          error: e.message
        }
      }))
      setFetchingAssets((prev) => ({
        ...prev,
        [`${account}-${currentNetwork}`]: {
          ...prev[`${account}-${currentNetwork}`],
          rpc: false
        }
      }))
      reject(e)
    }
  }

  const fetchAllSupplementTokenData = async (
    updatedTokens: any,
    _resolve: () => {},
    _reject: () => {}
  ) => {
    setFetchingAssets((prev) => ({
      ...prev,
      [`${account}-${currentNetwork}`]: {
        ...prev[`${account}-${currentNetwork}`],
        rpc: true
      }
    }))
    const unsignedRequests = eligibleRequests
      .map((t) => ({ ...t, txns: [t.txn.to, t.txn.value, t.txn.data] }))
      .map((t) => t.txns)

    const extendedSummary =
      eligibleRequests?.length &&
      eligibleRequests
        .map((req) => {
          const txn = toBundleTxn(req.txn, account)
          return getTransactionSummary(constants.humanizerInfo, txn, currentNetwork, account, {
            extended: true
          })
        })
        .flat()

    const tokensList = [
      ...(constants?.tokenList && constants?.tokenList[currentNetwork]
        ? constants.tokenList[currentNetwork]
        : []),
      ...((updatedTokens && updatedTokens.tokens?.length && updatedTokens.tokens) || [])
    ]

    // Remove unconfirmed and pending tokens from latest request,
    // оnly tokens which should be fetched with the latest state
    // If the token has a latest state - leave it as main one for balance oracle
    const latestTokens = removeDuplicatedAssets(
      updatedTokens?.tokens?.length &&
        updatedTokens.tokens
          .filter(
            (t) =>
              (!t.unconfirmed || !t.pending) &&
              !(t.unconfirmed && !t.latest) &&
              !(t.pending && !t.latest)
          )
          .map((t) => ({ ...(t.latest ? { ...t, ...t.latest } : { ...t }) }))
    )

    const tokensToFetchPrices = []
    // Check if not signed request contains tokens from swap which arent in portfolio yet
    extendedSummary.length &&
      extendedSummary.map(
        (s) =>
          s &&
          Array.isArray(s) &&
          s.length &&
          s.map((el) => {
            if (el?.type === 'token') {
              const tokenInPortfolio = latestTokens?.find((token) => token.address === el.address)

              if (!tokenInPortfolio || !tokenInPortfolio.price) {
                tokensToFetchPrices.push(el)
                if (!tokenInPortfolio) {
                  tokensList.push({ ...el, balance: 0 })
                }
              }
            }

            return el
          })
      )

    // 1. Fetch latest balance data from balanceOracle
    const balanceOracleLatest = new Promise((resolve) => {
      fetchSupplementTokenData({ tokens: latestTokens }, resolve, _reject, [], 'latest')
    })

    // 2. Fetch pending balance data from balanceOracle
    const balanceOraclePending =
      pendingTransactions?.length &&
      new Promise((resolve) => {
        fetchSupplementTokenData(
          { tokens: removeDuplicatedAssets(tokensList) },
          resolve,
          _reject,
          [],
          'pending'
        )
      })

    // 3. Fetching of unconfirmed/unsigned token data from balanceOracle
    const balanceOracleUnconfirmed =
      unsignedRequests?.length &&
      new Promise((resolve) => {
        fetchSupplementTokenData(
          { tokens: removeDuplicatedAssets(tokensList) },
          resolve,
          _reject,
          unsignedRequests,
          'unconfirmed'
        )
      })
    // Fetch coingecko prices for newly acquired tokens from swap transaction
    const coingeckoPrices =
      tokensToFetchPrices?.length &&
      new Promise((resolve) => {
        fetchCoingeckoPricesByContractAddress(tokensToFetchPrices, resolve)
      })

    const promises = [
      balanceOracleLatest,
      pendingTransactions?.length ? balanceOraclePending : [],
      unsignedRequests?.length ? balanceOracleUnconfirmed : [],
      tokensToFetchPrices?.length ? coingeckoPrices : []
    ]
    Promise.all([...promises])
      .then((results) => {
        // Fetched prices from coingecko
        const prices = results && results.length && results.find((el) => el.state === 'coingecko')
        if (prices) results.pop()

        const latestResponse = results.find(({ state }) => state === 'latest')
        // Remove empty array for not send promises
        const res = results.flat()
        const response =
          res.map((_res) => {
            return (
              _res &&
              _res.tokens &&
              _res.tokens.length &&
              _res.tokens
                .map((_t: Token) => {
                  const priceUpdate =
                    prices &&
                    prices?.tokens?.length &&
                    prices.tokens.find(
                      (pt) => pt.address.toLowerCase() === _t.address.toLowerCase()
                    )
                  const currTokenInPortfolio =
                    updatedTokens?.tokens?.length &&
                    updatedTokens?.tokens?.find(
                      (tk) => tk.address.toLowerCase() === _t.address.toLowerCase()
                    )

                  const { unconfirmed, latest, pending, ...newToken } = _t

                  const latestBalance = latestResponse?.tokens.find(
                    (token) => token.address === _t.address
                  )

                  const difference = Math.abs(
                    Number(latestBalance?.balance).toFixed(4) - Number(_t?.balance).toFixed(4)
                  ).toFixed(4)

                  const isAaveToken = _t?.coingeckoId?.startsWith('aave-')

                  const shouldDisplayState =
                    (latestBalance?.balance !== _t.balance || !latestBalance) &&
                    (isAaveToken ? !!(isAaveToken && difference > 0) : true)

                  const shouldDisplayToken = latestBalance || _t.balance > 0
                  if (!shouldDisplayToken) return

                  let tokenPrice = {}
                  if (priceUpdate) {
                    tokenPrice = {
                      ...priceUpdate,
                      balanceUSD: Number(parseFloat(_t.balance * priceUpdate.price || 0).toFixed(2))
                    }
                  } else if (currTokenInPortfolio?.price) {
                    tokenPrice = {
                      price: currTokenInPortfolio?.price
                    }
                  }

                  return {
                    ...newToken,
                    network: currentNetwork,
                    ...tokenPrice,
                    ...(latestBalance && {
                      latest: {
                        balanceUSD: Number(
                          parseFloat(latestBalance.balance * latestBalance.price || 0).toFixed(2)
                        ),
                        balance: latestBalance.balance,
                        balanceRaw: latestBalance.balanceRaw
                      }
                    }),
                    ...(shouldDisplayState && {
                      [_res.state]: {
                        balanceUSD: priceUpdate
                          ? Number(parseFloat(_t.balance * priceUpdate.price || 0).toFixed(2))
                          : Number(parseFloat(_t.balance * _t.price || 0).toFixed(2)),
                        balance: _t.balance,
                        difference: Number(
                          Math.abs(_t.balance - (latestBalance?.balance || 0)).toFixed(10)
                        ),
                        balanceIncrease: !!(_t.balance > (latestBalance?.balance || 0))
                      }
                    })
                  }
                })
                .filter((t) => t)
            )
          })[res.length - 1] || []

        _resolve && _resolve(response)
      })
      .catch(() => {
        const updatedBalance = assets?.tokens.map((t) =>
          t.latest
            ? {
                ...t,
                latest: { balance: t.balance, balanceUSD: t.balanceUSD, balanceRaw: t.balanceRaw }
              }
            : t
        )
        _reject && _reject(updatedBalance)
      })
  }

  const fetchAndSetSupplementTokenData = async (assets) => {
    if (!account) return
    await new Promise((resolve, reject) => {
      fetchAllSupplementTokenData(assets, resolve, reject)
    })
      .then((oracleResponse) => {
        setFetchingAssets((prev) => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            rpc: false
          }
        }))
        setAssetsByAccount((prev) => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            collectibles: assets?.nfts,
            tokens: oracleResponse?.length ? oracleResponse : assets?.tokens,
            loading: false,
            resultTime: new Date().valueOf()
          }
        }))
      })
      .catch(() => {
        const updatedBalance = assets?.tokens.map((t) =>
          t.latest
            ? {
                ...t,
                latest: { balance: t.balance, balanceUSD: t.balanceUSD, balanceRaw: t.balanceRaw }
              }
            : t
        )
        setAssetsByAccount((prev) => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            ...assets,
            collectibles: assets?.nfts,
            tokens: updatedBalance,
            loading: false
          }
        }))
        setFetchingAssets((prev) => ({
          ...prev,
          [`${account}-${currentNetwork}`]: {
            ...prev[`${account}-${currentNetwork}`],
            rpc: false
          }
        }))
      })
  }

  const findPrice = (contractAddress, priceList) => {
    // console.log(contractAddress, priceList)
    // const currPrice = priceList.filter((t) =>
    //   t.platforms ? Object.values(t.platforms).includes(contractAddress.toLowerCase()) : false
    // )[0]
    const currPrice = priceList.filter(
      (t) => t.address.toLowerCase() === contractAddress.toLowerCase()
    )
    console.log(currPrice)
    return currPrice ? currPrice.price : 0
  }

  const yearnishGetPrice = async (token, prices) => {
    const provider = getProvider(currentNetwork)
    if (!token || !token.abiFunction || !currentNetwork) return 0
    const contractAddress = token.shareProviderContractAddress || Object.values(token.platforms)[0]
    const contract = new Contract(contractAddress, [token.abi], provider)
    console.log(
      findPrice(token.contract_address, prices),
      (await contract[token.abiFunction]()).toString(),
      token.decimals
    )
    debugger
    return (
      (findPrice(token.contract_address, prices) *
        (await contract[token.abiFunction]()).toString()) /
      10 ** token.decimals
    )
  }

  const updateCoingeckoAndSupplementData = async (assets, minutes) => {
    if (fetchingAssets[`${account}-${currentNetwork}`]?.rpc || !account) return
    const tokens = assets?.tokens || []
    const minutesToCheckForUpdate = minutes ? 5 * 60 * 1000 : 2 * 60 * 1000
    // Check for not updated prices from coingecko in the last 2 minutes
    const coingeckoTokensToUpdate = tokens
      .filter((token) => token.coingeckoId)
      .filter(
        (token) =>
          !token?.priceUpdate || new Date().valueOf() - token.priceUpdate >= minutesToCheckForUpdate
      )
    console.log(tokens, constants?.customTokens, coingeckoTokensToUpdate)

    // Update custom tokens from ABI
    const customTokensToUpdate = constants?.customTokens?.filter(
      (t) => assets?.tokens.find((token) => token.coingeckoId === t.id) && t.abiFunction
    )

    // const customTokensPrices = (
    //   await Promise.all(
    //     customTokensToUpdate.map((ct) => yearnishGetPrice(ct, coingeckoTokensToUpdate))
    //   )
    // ).map((price, i) => ({ ...customTokensToUpdate[i], price, priceUpdate: new Date().getTime() }))
    // console.log(customTokensToUpdate, customTokensPrices)
    // debugger
    // Update prices from coingecko and balance from balance oracle
    if (coingeckoTokensToUpdate?.length) {
      const coingeckoPrices = new Promise((resolve, reject) => {
        fetchCoingeckoPrices(coingeckoTokensToUpdate, resolve, reject)
      })
      const balanceOracle = new Promise((resolve, reject) => {
        fetchAllSupplementTokenData({ tokens }, resolve, reject)
      })

      Promise.all([coingeckoPrices, balanceOracle])
        .then((results) => {
          const coingeckoResponse = results[0]
          const balanceOracleResponse = results[1]

          const updatedBalance = balanceOracleResponse
            .map((t) => {
              // eslint-disable-next-line no-prototype-builtins
              if (coingeckoResponse.hasOwnProperty(t.coingeckoId)) {
                return {
                  ...t,
                  price: coingeckoResponse[t.coingeckoId].usd,
                  balanceUSD: Number(
                    parseFloat(t.balance * coingeckoResponse[t.coingeckoId].usd || 0).toFixed(2)
                  ),
                  priceUpdate: new Date().valueOf(),
                  ...(t.latest && {
                    latest: {
                      balanceUSD: Number(
                        parseFloat(
                          t.latest.balance * coingeckoResponse[t.coingeckoId].usd || 0
                        ).toFixed(2)
                      ),
                      balance: t.latest.balance,
                      balanceRaw: t.latest.balanceRaw
                    }
                  })
                }
              }
              return t
            })
            .map((t) => customTokensPrices.find((ct) => ct.id === t.coingeckoId) || t)
          updatedBalance.length &&
            updateHumanizerData(updatedBalance, setKnownAddresses, setKnownTokens)
          setAssetsByAccount((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              ...assets,
              collectibles: assets?.nfts,
              tokens: updatedBalance?.length ? updatedBalance : assets?.tokens,
              loading: false,
              resultTime: new Date().valueOf()
            }
          }))
          setFetchingAssets((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              rpc: false
            }
          }))
        })
        .catch(() => {
          const updatedBalance = assets?.tokens.map((t) =>
            t.latest
              ? {
                  ...t,
                  latest: { balance: t.balance, balanceUSD: t.balanceUSD, balanceRaw: t.balanceRaw }
                }
              : t
          )
          setAssetsByAccount((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              ...assets,
              collectibles: assets?.nfts,
              tokens: updatedBalance,
              loading: false
            }
          }))
          setFetchingAssets((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              rpc: false
            }
          }))
        })
    } else {
      // Update only balance from balance oracle
      new Promise((resolve, reject) => {
        fetchAllSupplementTokenData({ tokens }, resolve, reject)
      })
        .then((oracleResponse) => {
          oracleResponse.length &&
            updateHumanizerData(oracleResponse, setKnownAddresses, setKnownTokens)
          setFetchingAssets((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              rpc: false
            }
          }))
          setAssetsByAccount((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              ...assets,
              collectibles: assets?.nfts,
              tokens: oracleResponse?.length ? oracleResponse : assets?.tokens,
              loading: false,
              resultTime: new Date().valueOf()
            }
          }))
        })
        .catch(() => {
          const updatedBalance = assets?.tokens.map((t) =>
            t.latest
              ? {
                  ...t,
                  latest: { balance: t.balance, balanceUSD: t.balanceUSD, balanceRaw: t.balanceRaw }
                }
              : t
          )
          setAssetsByAccount((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              ...assets,
              collectibles: assets?.nfts,
              tokens: updatedBalance,
              loading: false
            }
          }))
          setFetchingAssets((prev) => ({
            ...prev,
            [`${account}-${currentNetwork}`]: {
              ...prev[`${account}-${currentNetwork}`],
              rpc: false
            }
          }))
        })
    }
  }

  return {
    fetchAllSupplementTokenData,
    fetchSupplementTokenData,
    fetchAndSetSupplementTokenData,
    updateCoingeckoAndSupplementData
  }
}
