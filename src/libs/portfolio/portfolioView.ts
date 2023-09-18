import { NetworkId } from 'ambire-common/src/interfaces/networkDescriptor'

import {
  CollectionResult as CollectionResultInterface,
  PortfolioControllerState,
  TokenResult as TokenResultInterface
} from './interfaces'

interface AccountPortfolio {
  tokens: TokenResultInterface[]
  collections: CollectionResultInterface[]
  totalAmount: number
  isAllReady: boolean
}

const setFlags = (
  networkData: any,
  networkId: NetworkId,
  tokenNetwork: NetworkId,
  token: TokenResultInterface,
  feeTokens: TokenResultInterface[],
  gasTankFeeTokens: TokenResultInterface[]
) => {
  const onGasTank = networkId === 'gasTank'
  const isRewardsToken = networkId === 'rewards'
  const vesting = networkData.result?.xWalletClaimableBalance?.address === token.address
  const rewards = networkData.result?.walletClaimableBalance?.address === token.address
  const canTopUpGasTank = gasTankFeeTokens.some(
    (t) =>
      t.address === token.address &&
      (onGasTank || isRewardsToken ? t.networkId === tokenNetwork : t.networkId === networkId)
  )
  const isFeeToken = feeTokens.some(
    (t) =>
      t.address === token.address &&
      (onGasTank || isRewardsToken ? t.networkId === tokenNetwork : t.networkId === networkId)
  )

  return {
    onGasTank,
    isRewardsToken,
    vesting,
    rewards,
    canTopUpGasTank,
    isFeeToken
  }
}

export function calculateAccountPortfolio(
  selectedAccount: string | null,
  state: PortfolioControllerState,
  accountPortfolio: AccountPortfolio,
  feeTokens: { string: string }[],
  gasTankFeeTokens: { string: string }[]
) {
  const updatedTokens: any = []
  const updatedCollections: any = []
  let updatedTotalAmount = accountPortfolio?.totalAmount || 0
  let newTotalAmount: number = 0
  let allReady = true

  // 1. On update latest is empty {} in the beginning
  if (
    !selectedAccount ||
    !state.latest ||
    !state.latest[selectedAccount] ||
    Object.keys(state.latest[selectedAccount]).length === 0
  ) {
    return {
      tokens: accountPortfolio?.tokens || [],
      collections: accountPortfolio?.collections || [],
      totalAmount: accountPortfolio?.totalAmount || 0,
      isAllReady: true
    }
  }

  const selectedAccountData = state.latest[selectedAccount]

  // Function to check network status
  const isNetworkReady = (networkData) => {
    return networkData && networkData.isReady && !networkData.isLoading && networkData.result
  }

  // Convert the object keys to an array and iterate using forEach
  Object.keys(selectedAccountData).forEach((network) => {
    const networkData = selectedAccountData[network]

    if (isNetworkReady(networkData)) {
      // In the case we receive BigInt here, convert to number
      const networkTotal = Number(networkData.result.total?.usd) || 0
      newTotalAmount += networkTotal

      // Assuming you want to push tokens to updatedTokens array as well
      const networkTokens = networkData.result.tokens.map((t) => ({
        ...t,
        ...setFlags(networkData, network, t.networkId, t, feeTokens, gasTankFeeTokens)
      }))
      const networkCollections = networkData.result.collections || []
      updatedTokens.push(...networkTokens)
      updatedCollections.push(...networkCollections)

      if (networkTokens.length || networkCollections.length) {
        updatedTotalAmount += newTotalAmount
      }
    }

    if (!isNetworkReady(networkData)) {
      allReady = false
    }
  })

  return {
    totalAmount: newTotalAmount,
    tokens: updatedTokens,
    collections: updatedCollections,
    isAllReady: allReady
  }
}
