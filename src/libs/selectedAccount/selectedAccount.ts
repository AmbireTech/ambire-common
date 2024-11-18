import { getAddress } from 'ethers'

import { SelectedAccountPortfolio } from '../../interfaces/selectedAccount'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import {
  AccountState as DefiPositionsAccountState,
  PositionsByProvider
} from '../defiPositions/types'
import {
  AccountState,
  CollectionResult,
  NetworkNonces,
  NetworkState,
  TokenAmount,
  TokenResult
} from '../portfolio/interfaces'

export const updatePortfolioStateWithDefiPositions = (
  portfolioAccountState: AccountState,
  defiPositionsAccountState: DefiPositionsAccountState
) => {
  if (!portfolioAccountState || !defiPositionsAccountState) return portfolioAccountState

  Object.keys(portfolioAccountState).forEach((networkId) => {
    const networkState = portfolioAccountState[networkId]

    if (!networkState?.result) return

    let tokens = networkState.result.tokens || []
    let networkBalance = networkState.result.total?.usd || 0

    const positions = defiPositionsAccountState[networkId] || {}

    positions.positionsByProvider?.forEach((posByProv: PositionsByProvider) => {
      posByProv.positions.forEach((pos) => {
        pos.assets.forEach((a) => {
          const tokenInPortfolioIndex = tokens.findIndex((t) => {
            return getAddress(t.address) === getAddress(a.address) && t.networkId === networkId
          })

          if (tokenInPortfolioIndex !== -1) {
            const tokenInPortfolio = tokens[tokenInPortfolioIndex]
            const priceUSD = tokenInPortfolio.priceIn.find(
              ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
            )?.price
            const tokenBalanceUSD = priceUSD
              ? Number(
                  safeTokenAmountAndNumberMultiplication(
                    BigInt(tokenInPortfolio.amount),
                    tokenInPortfolio.decimals,
                    priceUSD
                  )
                )
              : undefined

            networkBalance -= tokenBalanceUSD || 0 // deduct portfolio token balance

            tokens = tokens.map((token, idx) => {
              if (idx === tokenInPortfolioIndex) {
                return {
                  ...token,
                  flags: {
                    ...(token.flags || {}),
                    isDefiToken: true
                  }
                } as TokenResult
              }

              return token
            })
          }
        })

        networkBalance += posByProv.positionInUSD || 0
      })
    })

    // eslint-disable-next-line no-param-reassign
    portfolioAccountState[networkId]!.result!.total.usd = networkBalance
    // eslint-disable-next-line no-param-reassign
    portfolioAccountState[networkId]!.result!.tokens = tokens
  })

  return portfolioAccountState
}

export function calculateSelectedAccountPortfolio(
  latestStateSelectedAccount: AccountState,
  pendingStateSelectedAccount: AccountState,
  accountPortfolio: SelectedAccountPortfolio | null,
  hasSignAccountOp?: boolean
) {
  const updatedTokens: TokenResult[] = []
  const updatedCollections: CollectionResult[] = []

  let newTotalBalance: number = 0
  let allReady = true

  const hasLatest = latestStateSelectedAccount
  const hasPending = pendingStateSelectedAccount && Object.keys(pendingStateSelectedAccount).length
  if (!hasLatest && !hasPending) {
    return {
      tokens: accountPortfolio?.tokens || [],
      collections: accountPortfolio?.collections || [],
      totalBalance: accountPortfolio?.totalBalance || 0,
      isAllReady: false,
      simulationNonces: accountPortfolio?.simulationNonces || {},
      tokenAmounts: accountPortfolio?.tokenAmounts || [],
      latest: latestStateSelectedAccount,
      pending: pendingStateSelectedAccount
    } as SelectedAccountPortfolio
  }

  let selectedAccountData = latestStateSelectedAccount

  const pendingAccountStateWithoutCriticalErrors = Object.keys(pendingStateSelectedAccount).reduce(
    (acc, network) => {
      if (
        !selectedAccountData[network]?.result?.blockNumber ||
        !pendingStateSelectedAccount[network]?.result?.blockNumber
      )
        return acc

      // Filter out networks with critical errors.
      // Additionally, use the pending state if either of the following conditions is true:
      // - The pending block number is newer than the latest. Keep in mind that we always update both the latest and pending portfolio state,
      //   regardless of whether we have an acc op for simulation or not. Because of this, if the pending state is newer, we use it in place of the latest state.
      // - We have a signed acc op, meaning we are performing a simulation and want to visualize pending badges (pending-to-be-confirmed and pending-to-be-signed).
      const isPendingNewer =
        pendingStateSelectedAccount[network]?.result?.blockNumber! >=
        selectedAccountData[network]?.result?.blockNumber!

      if (
        !pendingStateSelectedAccount[network]?.criticalError &&
        (isPendingNewer || hasSignAccountOp)
      ) {
        acc[network] = pendingStateSelectedAccount[network]
      }
      return acc
    },
    {} as AccountState
  )

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
      newTotalBalance += networkTotal

      const networkTokens = result?.tokens || []
      const networkCollections = result?.collections || []

      updatedTokens.push(...networkTokens)
      updatedCollections.push(...networkCollections)
    }

    if (!isNetworkReady(networkData)) {
      allReady = false
    }
  })

  // For the selected account's pending state, create a SimulationNonces mapping,
  // which associates each network with its corresponding pending simulation beforeNonce.
  // This nonce information is crucial for determining the PendingToBeSigned or PendingToBeConfirmed Dashboard badges.
  // For more details, see: calculatePendingAmounts.
  const simulationNonces = Object.keys(pendingStateSelectedAccount).reduce((acc, networkId) => {
    const beforeNonce = pendingStateSelectedAccount[networkId]?.result?.beforeNonce
    if (typeof beforeNonce === 'bigint') {
      acc[networkId] = beforeNonce
    }

    return acc
  }, {} as NetworkNonces)

  // We need the latest and pending token amounts for the selected account, especially for calculating the Pending badges.
  // You might wonder why we don't retrieve this data directly from the PortfolioController. Here's the reasoning:
  //
  // 1. We could attach the latest amount to the controller's pending state.
  //    However, this would mix the latest and pending data within the controller's logic, which we want to avoid.
  //
  // 2. Alternatively, we could fetch the latest and pending token amounts at the component level as needed.
  //    While this seems simpler, there's a catch:
  //    The PortfolioView is recalculated whenever certain properties change.
  //    If we don't retrieve the latest and pending amounts within the same React update cycle,
  //    they might become out of sync with the PortfolioView state.
  //    Therefore, the safest and cleanest approach is to calculate these amounts during the same cycle as the PortfolioView.
  //
  // For more details, see: calculatePendingAmounts.
  const tokenAmounts = Object.keys(pendingStateSelectedAccount).reduce((acc, networkId) => {
    const latestTokens = pendingStateSelectedAccount[networkId]?.result?.tokens

    if (!latestTokens) return acc

    const mergedTokens = latestTokens.map((latestToken) => {
      const pendingToken = pendingStateSelectedAccount[networkId]?.result?.tokens.find(
        (pending) => {
          return pending.address === latestToken.address
        }
      )

      return {
        latestAmount: latestToken.amount || 0n,
        pendingAmount: pendingToken?.amount || 0n,
        address: latestToken.address,
        networkId
      }
    })

    return [...acc, ...mergedTokens]
  }, [] as TokenAmount[])

  return {
    totalBalance: newTotalBalance,
    tokens: updatedTokens,
    collections: updatedCollections,
    isAllReady: allReady,
    simulationNonces,
    tokenAmounts,
    latest: latestStateSelectedAccount,
    pending: pendingStateSelectedAccount
  } as SelectedAccountPortfolio
}
