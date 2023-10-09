import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import {
  AccountState,
  AdditionalAccountState,
  AdditionalPortfolioGetResult,
  CollectionResult as CollectionResultInterface,
  PortfolioControllerState,
  PortfolioGetResult,
  TokenResult as TokenResultInterface
} from './interfaces'

interface AccountPortfolio {
  tokens: TokenResultInterface[]
  collections: CollectionResultInterface[]
  totalAmount: number
  isAllReady: boolean
}

export function calculateAccountPortfolio(
  selectedAccount: string | null,
  state: { latest: PortfolioControllerState },
  accountPortfolio: AccountPortfolio
) {
  const updatedTokens: TokenResultInterface[] = []
  const updatedCollections: CollectionResultInterface[] = []

  let newTotalAmount: number = 0
  let allReady = true

  // 1. On update latest is empty {} in the beginning
  if (!selectedAccount || !state.latest || !state.latest[selectedAccount]) {
    return {
      tokens: accountPortfolio?.tokens || [],
      collections: accountPortfolio?.collections || [],
      totalAmount: accountPortfolio?.totalAmount || 0,
      isAllReady: true
    }
  }

  const selectedAccountData = state.latest[selectedAccount] || undefined
  if (!selectedAccountData) {
    return {
      tokens: accountPortfolio?.tokens || [],
      collections: accountPortfolio?.collections || [],
      totalAmount: accountPortfolio?.totalAmount || 0,
      isAllReady: true
    }
  }

  const isNetworkReady = (networkData: AccountState | AdditionalAccountState | undefined) => {
    return (
      (networkData && networkData.isReady && !networkData.isLoading) || networkData?.criticalError
    )
  }

  Object.keys(selectedAccountData).forEach((network: string) => {
    const networkData = selectedAccountData[network] as
      | AccountState
      | AdditionalAccountState
      | undefined

    const result = networkData?.result as
      | PortfolioGetResult
      | AdditionalPortfolioGetResult
      | undefined

    if (isNetworkReady(networkData) && !networkData?.criticalError && result) {
      // In the case we receive BigInt here, convert to number
      const networkTotal = Number(result?.total?.usd) || 0
      newTotalAmount += networkTotal

      const networkTokens = result?.tokens || []
      const networkCollections = result?.collections || []

      updatedTokens.push(...networkTokens)
      updatedCollections.push(...networkCollections)
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

export type PendingToken = TokenResultInterface & {
  amountToSend: TokenResultInterface['amount']
  type: 'send' | 'receive' | null
}

export function calculateTokensPendingState(
  selectedAccount: string,
  network: NetworkDescriptor,
  state: { pending: PortfolioControllerState }
): PendingToken[] {
  const pendingData = state.pending[selectedAccount][network.id]

  if (!pendingData || !pendingData.isReady || !pendingData.result) {
    return []
  }

  const { tokens } = pendingData.result

  const tokensWithChangedAmounts = tokens.filter((token) => {
    if (!token.amountPostSimulation) return false
    if (token.amount !== token.amountPostSimulation) {
      return true
    }
    return false
  })

  return tokensWithChangedAmounts.map((token) => {
    let type: PendingToken['type'] = null
    const amountToSend =
      token.amount - token.amountPostSimulation! >= 0n
        ? token.amount - token.amountPostSimulation!
        : token.amountPostSimulation! - token.amount!

    if (token.amount > token.amountPostSimulation!) {
      type = 'send'
    }

    if (token.amount < token.amountPostSimulation!) {
      type = 'receive'
    }

    return {
      ...token,
      amountToSend,
      type
    }
  })
}
