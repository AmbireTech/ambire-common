import { Account } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import {
  AccountState,
  CollectionResult as CollectionResultInterface,
  NetworkState,
  PortfolioControllerState,
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
  state: { latest: PortfolioControllerState; pending: PortfolioControllerState },
  accountPortfolio: AccountPortfolio,
  account: Account
) {
  const updatedTokens: TokenResultInterface[] = []
  const updatedCollections: CollectionResultInterface[] = []

  let newTotalAmount: number = 0
  let allReady = true

  if (!selectedAccount) {
    return {
      tokens: accountPortfolio?.tokens || [],
      collections: accountPortfolio?.collections || [],
      totalAmount: accountPortfolio?.totalAmount || 0,
      isAllReady: true
    }
  }

  const hasLatest = state.latest && state.latest[selectedAccount]
  const hasPending =
    state.pending &&
    state.pending[selectedAccount] &&
    Object.keys(state.pending[selectedAccount]).length
  if (!hasLatest && !hasPending) {
    return {
      tokens: accountPortfolio?.tokens || [],
      collections: accountPortfolio?.collections || [],
      totalAmount: accountPortfolio?.totalAmount || 0,
      isAllReady: false
    }
  }

  let selectedAccountData = state.latest[selectedAccount]

  const pendingAccountStateWithoutCriticalErrors = Object.keys(
    state.pending[selectedAccount]
  ).reduce((acc, network) => {
    // Filter out networks with critical errors
    // and pending state which is with newer blockNumber

    const isPendingNewer = state.pending[selectedAccount][network]?.result?.blockNumber >= selectedAccountData[network]?.result?.blockNumber
    console.log('isPendingNewer', isPendingNewer)
    if (!state.pending[selectedAccount][network]?.criticalError && isPendingNewer) {
      acc[network] = state.pending[selectedAccount][network]
    }
    return acc
  }, {} as AccountState)

  if (hasPending && Object.keys(pendingAccountStateWithoutCriticalErrors).length > 0) {
    // Mix latest and pending data. This is required because pending state may only have some networks
    selectedAccountData = {
      ...selectedAccountData,
      ...pendingAccountStateWithoutCriticalErrors
    }
  }

  const isNetworkReady = (networkData: NetworkState | undefined) => {
    return (
      (networkData && networkData.isReady && !networkData.isLoading) || networkData?.criticalError
    )
  }

  Object.keys(selectedAccountData).forEach((network: string) => {
    const networkData = selectedAccountData[network]
    const result = networkData?.result

    if (networkData && isNetworkReady(networkData) && !networkData?.criticalError && result) {
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
  network: Network,
  state: { pending: PortfolioControllerState }
): PendingToken[] {
  const pendingData = state.pending[selectedAccount][network.id]

  if (!pendingData || !pendingData.isReady || !pendingData.result) {
    return []
  }

  const { tokens } = pendingData.result

  // sometimes an old pending state that does not yet have amountPostSimulation
  // set and breaks the logic below. If that's the case, wait for the
  // simulation to complete
  if (!tokens.length || !('amountPostSimulation' in tokens[0])) {
    return []
  }

  const tokensWithChangedAmounts = tokens.filter(
    (token) => token.amount !== token.amountPostSimulation
  )

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
