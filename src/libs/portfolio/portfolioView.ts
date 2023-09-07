import { formatUnits } from 'ethers'

import { TokenResult as TokenResultInterface } from './interfaces'

// Calculate Gas Tank Balance Sum
export function totalGasTankBalance(additionalPortfolio: any) {
  return (
    additionalPortfolio?.gasTank?.balance?.reduce((total: any, token: any) => {
      const priceInUSD = token?.priceIn?.find(({ baseCurrency }: any) => baseCurrency === 'usd')
      if (priceInUSD) {
        const balanceUSD =
          parseFloat(formatUnits(BigInt(token?.amount ?? 0), token?.decimals ?? 0)) *
          priceInUSD.price
        return total + balanceUSD
      }
      return total
    }, 0) ?? 0
  )
}

export function totalRewardsBalance(additionalPortfolio: any) {
  function calculateClaimableBalance(property: string) {
    if (
      additionalPortfolio.rewards[property] &&
      Object.keys(additionalPortfolio.rewards[property]).length
    ) {
      const { amount, decimals, priceIn }: TokenResultInterface =
        additionalPortfolio.rewards[property]
      const usdPrice = priceIn.find(({ baseCurrency }: any) => baseCurrency === 'usd')?.price || 0
      const formattedAmount = formatUnits(BigInt(amount), decimals)
      return parseFloat(formattedAmount) * usdPrice || 0
    }
    return 0
  }

  const walletClaimableBalance = calculateClaimableBalance('walletClaimableBalance')
  const xWalletClaimableBalance = calculateClaimableBalance('xWalletClaimableBalance')

  return walletClaimableBalance + xWalletClaimableBalance
}

export function calculateAccountPortfolio(
  selectedAccount,
  state,
  accountPortfolio,
  additionalPortfolio
): any {
  const updatedTokens: any = []
  const updatedCollections: any = []
  const updatedTotalAmount = accountPortfolio?.totalAmount || 0
  let newTotalAmount: number =
    totalGasTankBalance(additionalPortfolio) + totalRewardsBalance(additionalPortfolio)
  let allReady = true

  if (!selectedAccount || !state.latest || !state.latest[selectedAccount]) {
    return {
      tokens: updatedTokens,
      collections: updatedCollections,
      totalAmount: updatedTotalAmount,
      isAllReady: allReady
    }
  }

  const selectedAccountData = state.latest[selectedAccount]
  // Convert the object keys to an array and iterate using forEach
  Object.keys(selectedAccountData).forEach((network) => {
    const networkData = selectedAccountData[network]

    if (networkData && networkData.isReady && !networkData.isLoading && networkData.result) {
      // In the case we receive BigInt here, convert to number
      const networkTotal = Number(networkData.result.total?.usd) || 0
      newTotalAmount += networkTotal

      // Assuming you want to push tokens to updatedTokens array as well
      const networkTokens = networkData.result.tokens
      const networkCollections = networkData.result.collections || []
      updatedTokens.push(...networkTokens)
      updatedCollections.push(...networkCollections)

      if (networkTokens.length || networkCollections.length) {
        return {
          totalAmount: updatedTotalAmount,
          isAllReady: allReady,
          tokens: updatedTokens,
          collections: updatedCollections
        }
      }
    } else if (networkData && networkData.isReady && networkData.isLoading) {
      // Handle the case where network is ready but still loading
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
