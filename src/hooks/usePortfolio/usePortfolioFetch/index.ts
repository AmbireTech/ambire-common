// @ts-nocheck TODO: Fill in all missing types before enabling the TS check again

import { useMemo } from 'react'

import useCoingeckoFetch from 'ambire-common/src/hooks/usePortfolio/usePortfolioFetch/useCoingeckoFetch'
import useBalanceOracleFetch from 'ambire-common/src/hooks/usePortfolio/usePortfolioFetch/useBalanceOracleFetch'
import useVelcroFetch from 'ambire-common/src/hooks/usePortfolio/usePortfolioFetch/useVelcroFetch'

import { Token, Network } from 'ambire-common/src/hooks/usePortfolio/types'

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
  constants,
  setItems
}) {
  const extraTokensAssets = useMemo(
    () => getExtraTokensAssets(account, currentNetwork),
    [account, extraTokens, currentNetwork]
  )
  
  // All logic and functions required for coingecko fetching
  const { fetchCoingeckoPrices,
    fetchCoingeckoPricesByContractAddress } = useCoingeckoFetch({
    account,
    currentNetwork,
    setAssetsByAccount,
    addToast,
    getCoingeckoPrices,
    getCoingeckoPriceByContract,
    getCoingeckoAssetPlatforms,
    setItems,
  })

  // All balance oracle functions which we need
  const { fetchAllSupplementTokenData,
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
    setItems
  })

  // Remaining logic - velcro balance fetching 
  const { fetchOtherNetworksBalances,
    fetchTokens
  } = useVelcroFetch({
    account,
    currentAccount,
    currentNetwork,
    setAssetsByAccount,
    addToast,
    getBalances,
    filterByHiddenTokens,
    updateCoingeckoAndSupplementData,
    fetchAndSetSupplementTokenData,
    hiddenTokens,
    extraTokensAssets,
    eligibleRequests,
    setItems
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
