import { getAddress } from 'ethers'

import {
  SelectedAccountPortfolio,
  SelectedAccountPortfolioState,
  SelectedAccountPortfolioTokenResult
} from '../../interfaces/selectedAccount'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'
import {
  AccountState as DefiPositionsAccountState,
  AssetType,
  PositionsByProvider
} from '../defiPositions/types'
import {
  AccountState,
  CollectionResult,
  NetworkSimulatedAccountOp,
  NetworkState
} from '../portfolio/interfaces'

export const updatePortfolioStateWithDefiPositions = (
  portfolioAccountState: AccountState,
  defiPositionsAccountState: DefiPositionsAccountState,
  areDefiPositionsLoading: boolean
) => {
  if (!portfolioAccountState || !defiPositionsAccountState || areDefiPositionsLoading)
    return portfolioAccountState

  Object.keys(portfolioAccountState).forEach((networkId) => {
    const networkState = portfolioAccountState[networkId]

    if (!networkState?.result || defiPositionsAccountState[networkId]?.isLoading) return

    let tokens = networkState.result.tokens || []
    let networkBalance = networkState.result.total?.usd || 0

    const positions = defiPositionsAccountState[networkId] || {}

    positions.positionsByProvider?.forEach((posByProv: PositionsByProvider) => {
      if (posByProv.type === 'liquidity-pool') {
        networkBalance += posByProv.positionInUSD || 0
        return
      }

      posByProv.positions.forEach((pos) => {
        pos.assets
          .filter((a) => a.type !== AssetType.Liquidity && a.protocolAsset)
          .forEach((a) => {
            const tokenInPortfolioIndex = tokens.findIndex((t) => {
              return (
                getAddress(t.address) === getAddress(a.protocolAsset!.address) &&
                t.networkId === networkId
              )
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
              tokens = tokens.filter((_, index) => index !== tokenInPortfolioIndex)
            }

            // Add only the balance of the collateral tokens to the network balance
            if (a.type === AssetType.Collateral) {
              const protocolPriceUSD = a.priceIn.find(
                ({ baseCurrency }: { baseCurrency: string }) => baseCurrency.toLowerCase() === 'usd'
              )?.price

              const protocolTokenBalanceUSD = protocolPriceUSD
                ? Number(
                    safeTokenAmountAndNumberMultiplication(
                      BigInt(a.amount),
                      Number(a.protocolAsset!.decimals),
                      protocolPriceUSD
                    )
                  )
                : undefined

              networkBalance += protocolTokenBalanceUSD || 0
            }
            tokens.push({
              amount: a.amount,
              // Only list the borrowed asset with no price
              priceIn: a.type === AssetType.Collateral ? a.priceIn : [],
              decimals: Number(a.protocolAsset!.decimals),
              address: a.protocolAsset!.address,
              symbol: a.protocolAsset!.symbol,
              networkId,
              flags: {
                canTopUpGasTank: false,
                isFeeToken: false,
                onGasTank: false,
                rewardsType: null
              }
            })
          })
      })
    })

    // eslint-disable-next-line no-param-reassign
    portfolioAccountState[networkId]!.result!.total.usd = networkBalance
    // eslint-disable-next-line no-param-reassign
    portfolioAccountState[networkId]!.result!.tokens = tokens
  })

  return portfolioAccountState
}

const stripPortfolioState = (portfolioState: AccountState) => {
  const strippedState: SelectedAccountPortfolioState = {}

  Object.keys(portfolioState).forEach((networkId) => {
    const networkState = portfolioState[networkId]
    if (!networkState) return

    if (!networkState.result) {
      strippedState[networkId] = networkState
      return
    }

    // A trick to exclude specific keys
    const { tokens, collections, tokenErrors, priceCache, hintsFromExternalAPI, ...result } =
      networkState.result

    strippedState[networkId] = {
      ...networkState,
      result
    }
  })

  return strippedState
}

const isNetworkReady = (networkData: NetworkState | undefined) => {
  return (
    networkData && (networkData.isReady || networkData?.criticalError) && !networkData.isLoading
  )
}

export function calculateSelectedAccountPortfolio(
  latestStateSelectedAccount: AccountState,
  pendingStateSelectedAccount: AccountState,
  accountPortfolio: SelectedAccountPortfolio | null,
  hasSignAccountOp?: boolean
) {
  const collections: CollectionResult[] = []
  const tokens: SelectedAccountPortfolioTokenResult[] = []

  let newTotalBalance: number = 0

  const hasLatest = latestStateSelectedAccount && Object.keys(latestStateSelectedAccount).length
  let allReady = !!hasLatest

  const hasPending = pendingStateSelectedAccount && Object.keys(pendingStateSelectedAccount).length
  if (!hasLatest && !hasPending) {
    return {
      tokens: accountPortfolio?.tokens || [],
      collections: accountPortfolio?.collections || [],
      totalBalance: accountPortfolio?.totalBalance || 0,
      isAllReady: false,
      networkSimulatedAccountOp: accountPortfolio?.networkSimulatedAccountOp || {},
      latest: latestStateSelectedAccount,
      pending: pendingStateSelectedAccount
    } as SelectedAccountPortfolio
  }

  let selectedAccountData = latestStateSelectedAccount

  /**
   * Replaces the latest state if the following conditions are true:
   * - There is no critical error in the pending state.
   * - The pending block number is newer than the latest OR we have a signed acc op (because of simulation).
   */
  const validSelectedAccountPendingState: AccountState = {}
  const simulatedAccountOps: NetworkSimulatedAccountOp = {}

  Object.keys(pendingStateSelectedAccount).forEach((network) => {
    const pendingNetworkData = pendingStateSelectedAccount[network]
    const latestNetworkData = latestStateSelectedAccount[network]

    if (!latestNetworkData?.result?.blockNumber || !pendingNetworkData?.result?.blockNumber) return

    const isPendingNewer =
      pendingNetworkData.result.blockNumber! >= latestNetworkData.result.blockNumber!

    if (!pendingNetworkData.criticalError && (isPendingNewer || hasSignAccountOp)) {
      validSelectedAccountPendingState[network] = pendingNetworkData
    }

    const accountOp = pendingNetworkData?.accountOps?.[0]

    if (accountOp) {
      simulatedAccountOps[network] = accountOp
    }

    const pendingTokens = pendingNetworkData?.result?.tokens
    if (pendingTokens) {
      const networkTokens = pendingTokens.map((pendingToken) => {
        const latestToken = latestNetworkData?.result?.tokens.find((latest) => {
          return latest.address === pendingToken.address
        })

        return {
          // Token .amount is the pending amount if there is a pending amount, otherwise it is the latest amount
          ...pendingToken,
          latestAmount: latestToken?.amount,
          pendingAmount: pendingToken.amount
        }
      })

      tokens.push(...networkTokens)
    }
  })

  if (hasPending && Object.keys(validSelectedAccountPendingState).length > 0) {
    selectedAccountData = {
      ...selectedAccountData,
      ...validSelectedAccountPendingState
    }
  }

  Object.keys(selectedAccountData).forEach((network: string) => {
    const networkData = selectedAccountData[network]
    const result = networkData?.result
    if (networkData && isNetworkReady(networkData) && result) {
      const networkTotal = Number(result?.total?.usd) || 0
      newTotalBalance += networkTotal

      const networkCollections = result?.collections || []
      collections.push(...networkCollections)
    }

    if (!isNetworkReady(networkData)) {
      allReady = false
    }
  })

  return {
    totalBalance: newTotalBalance,
    tokens,
    collections,
    isAllReady: allReady,
    networkSimulatedAccountOp: simulatedAccountOps,
    latest: stripPortfolioState(latestStateSelectedAccount),
    pending: stripPortfolioState(pendingStateSelectedAccount)
  } as SelectedAccountPortfolio
}
