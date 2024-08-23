import { formatUnits } from 'ethers'

// TODO: Determining the token's pending state (pending-to-be-signed or pending-to-be-confirmed) is quite complex,
//  with over six possible variations. We should thoroughly document all potential scenarios.
//  Additionally, creating unit tests for this function is highly recommended.
export const calculatePendingAmounts = (
  latestAmount: bigint,
  pendingAmount: bigint,
  priceUSD: number,
  decimals: number,
  amountPostSimulation?: bigint,
  simulationDelta?: bigint, // pending delta (this is the amount of the simulation itself)
  activityNonce?: bigint,
  portfolioNonce?: bigint
) => {
  const onChainToBeConfirmedDelta = pendingAmount - latestAmount

  // There is no Pending state changes
  if (onChainToBeConfirmedDelta === 0n && !simulationDelta) return {}

  let pendingBalance

  if (onChainToBeConfirmedDelta && !amountPostSimulation) {
    pendingBalance = parseFloat(formatUnits(pendingAmount, decimals))
  } else {
    pendingBalance = parseFloat(formatUnits(amountPostSimulation!, decimals))
  }

  const pendingBalanceUSD = priceUSD && pendingBalance ? pendingBalance * priceUSD : undefined

  const result: any = {
    isPending: true,
    pendingBalance,
    pendingBalanceUSD
  }

  if (simulationDelta) {
    const hasPendingToBeConfirmed = activityNonce && activityNonce === portfolioNonce

    if (hasPendingToBeConfirmed) {
      result.pendingToBeConfirmed = simulationDelta
    } else {
      result.pendingToBeSigned = simulationDelta
    }
  }

  if (onChainToBeConfirmedDelta) {
    const pendingToBeConfirmed = result.pendingToBeConfirmed
      ? result.pendingToBeConfirmed + onChainToBeConfirmedDelta
      : onChainToBeConfirmedDelta
    result.pendingToBeConfirmed = pendingToBeConfirmed
  }

  return result
}
