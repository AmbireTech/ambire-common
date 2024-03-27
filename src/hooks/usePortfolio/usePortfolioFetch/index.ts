// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useMemo } from 'react'

import useCoingeckoFetch from './useCoingeckoFetch'
import useBalanceOracleFetch from './useBalanceOracleFetch'
import useVelcroFetch from './useVelcroFetch'
import { setKnownAddresses, setKnownTokens } from '../../../services/humanReadableTransactions'
// eslint-disable-next-line import/no-cycle
import {
  checkTokenList,
  getTokenListBalance,
  removeDuplicatedAssets
} from '../../../services/balanceOracle'

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
  filterByHiddenTokens,
  extraTokens,
  pendingTransactions,
  eligibleRequests,
  selectedAccount,
  constants,
  fetchingAssets,
  setFetchingAssets,
  оtherNetworksFetching,
  setOtherNetworksFetching,
  getCoingeckoCoin,
  requestPendingState,
  pendingTokens,
  setPendingTokens
}) {
  const extraTokensAssets = useMemo(
    () => getExtraTokensAssets(account, currentNetwork),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account, extraTokens, currentNetwork, getExtraTokensAssets]
  )

  // All logic and functions required for coingecko fetching
  const { fetchCoingeckoPrices, fetchCoingeckoPricesByContractAddress } = useCoingeckoFetch({
    currentNetwork,
    addToast,
    getCoingeckoPrices,
    getCoingeckoPriceByContract,
    getCoingeckoCoin
  })

  // All balance oracle functions which we need
  const {
    fetchAllSupplementTokenData,
    fetchSupplementTokenData,
    fetchAndSetSupplementTokenData,
    updateCoingeckoAndSupplementData
  } = useBalanceOracleFetch({
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
    checkTokenList,
    requestPendingState,
    pendingTokens,
    setPendingTokens
  })

  // Remaining logic - velcro balance fetching
  const { fetchOtherNetworksBalances, fetchTokens } = useVelcroFetch({
    currentAccount,
    currentNetwork,
    setAssetsByAccount,
    addToast,
    getBalances,
    filterByHiddenTokens,
    updateCoingeckoAndSupplementData,
    extraTokensAssets,
    getExtraTokensAssets,
    eligibleRequests,
    pendingTransactions,
    fetchingAssets,
    setFetchingAssets,
    оtherNetworksFetching,
    setOtherNetworksFetching,
    removeDuplicatedAssets,
    requestPendingState,
    pendingTokens,
    setPendingTokens,
    constants
  })

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
