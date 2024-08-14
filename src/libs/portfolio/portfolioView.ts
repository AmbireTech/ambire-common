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
  portfolioNonces: { [networkId: string]: bigint }
  tokenAmounts: {
    latestAmount: bigint
    pendingAmount: bigint
    address: string
    networkId: string
  }[]
}

export function calculateAccountPortfolio(
  selectedAccount: string | null,
  state: { latest: PortfolioControllerState; pending: PortfolioControllerState },
  accountPortfolio: AccountPortfolio,
  hasSignAccountOp: null | boolean
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
      isAllReady: true,
      portfolioNonces: accountPortfolio?.portfolioNonces || {},
      tokenAmounts: accountPortfolio?.tokenAmounts || []
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
      isAllReady: false,
      portfolioNonces: accountPortfolio?.portfolioNonces || {},
      tokenAmounts: accountPortfolio?.tokenAmounts || []
    }
  }

  let selectedAccountData = state.latest[selectedAccount]

  const pendingAccountStateWithoutCriticalErrors = Object.keys(
    state.pending[selectedAccount]
  ).reduce((acc, network) => {
    if (
      !selectedAccountData[network]?.result?.blockNumber ||
      !state.pending[selectedAccount][network]?.result?.blockNumber
    )
      return acc

    // Filter out networks with critical errors.
    // Additionally, use the pending state if either of the following conditions is true:
    // - The pending block number is newer than the latest. Keep in mind that we always update both the latest and pending portfolio state,
    //   regardless of whether we have an acc op for simulation or not. Because of this, if the pending state is newer, we use it in place of the latest state.
    // - We have a signed acc op, meaning we are performing a simulation and want to visualize pending badges (pending-to-be-confirmed and pending-to-be-signed).
    const isPendingNewer =
      state.pending[selectedAccount][network]?.result?.blockNumber! >=
      selectedAccountData[network]?.result?.blockNumber!

    if (
      !state.pending[selectedAccount][network]?.criticalError &&
      (isPendingNewer || hasSignAccountOp)
    ) {
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
      networkData && (networkData.isReady || networkData?.criticalError) && !networkData.isLoading
    )
  }

  Object.keys(selectedAccountData).forEach((network: string) => {
    const networkData = selectedAccountData[network]
    const result = networkData?.result

    if (networkData && isNetworkReady(networkData) && result) {
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

  const portfolioNonces = Object.keys(state.pending[selectedAccount]).reduce((acc, networkId) => {
    const beforeNonce = state.pending[selectedAccount!][networkId]?.result?.beforeNonce
    if (beforeNonce !== undefined) {
      acc[networkId] = beforeNonce
    }

    return acc
  }, {} as { [networkId: string]: bigint })

  const tokenAmounts = Object.keys(state.pending[selectedAccount]).reduce((acc, networkId) => {
    const pendingTokens = state.pending[selectedAccount!][networkId]?.result?.tokens

    if (!pendingTokens) return acc

    const mergedTokens = pendingTokens.map((pendingToken) => {
      const latestToken = state.latest[selectedAccount!][networkId]?.result?.tokens.find(
        (_latestToken) => {
          return _latestToken.address === pendingToken.address
        }
      )

      return {
        latestAmount: latestToken!.amount,
        pendingAmount: pendingToken.amount,
        address: latestToken!.address,
        networkId
      }
    })

    return [...acc, ...mergedTokens]
  }, [] as { latestAmount: bigint; pendingAmount: bigint; address: string; networkId: string }[])

  return {
    totalAmount: newTotalAmount,
    tokens: updatedTokens,
    collections: updatedCollections,
    isAllReady: allReady,
    // TODO: Docs. Better naming.
    portfolioNonces,
    tokenAmounts
  }
}
