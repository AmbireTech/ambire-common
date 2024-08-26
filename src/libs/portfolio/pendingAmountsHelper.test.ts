import { expect } from '@jest/globals'
import { calculatePendingAmounts } from './pendingAmountsHelper'

describe('Portfolio -> Pending Amounts Helper', () => {
  describe('calculatePendingAmounts', () => {
    test('[PendingToBeSigned] - Having simulation and the AccOp is not broadcasted yet; should result in `pendingToBeSigned` badge', async () => {
      const latestAmount = 2000000000000000000n
      const pendingAmount = 2000000000000000000n
      const amountPostSimulation = 1000000000000000000n
      const activityNonce = 1n
      const portfolioNonce = 2n

      const simulationDelta = -1000000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        activityNonce,
        portfolioNonce
      )

      expect(result).toEqual({
        isPending: true,
        pendingBalance: 1000000000000000000n,
        pendingToBeSigned: -1000000000000000000n // Here we expect pendingToBeSigned property
      })
    })

    test('[PendingToBeConfirmed] - Having simulation, but the AccOp is already broadcasted (but not confirmed); should result in pendingToBeConfirmed badge', async () => {
      const latestAmount = 2000000000000000000n
      const pendingAmount = 2000000000000000000n
      const amountPostSimulation = 1000000000000000000n

      // Once the AccOp is broadcasted and added to the Activity, there is a brief period
      // where the Activity nonce matches the latest simulation nonce, indicating a `pendingToBeConfirmed` amount.
      const activityNonce = 2n
      const portfolioNonce = 2n

      const simulationDelta = -1000000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        activityNonce,
        portfolioNonce
      )

      expect(result).toEqual({
        isPending: true,
        pendingBalance: 1000000000000000000n,
        pendingToBeConfirmed: -1000000000000000000n // Here we expect pendingToBeConfirmed property
      })
    })

    test('[PendingToBeConfirmed] - Having difference between token latest and pending amounts; should result in `pendingToBeConfirmed` badge', async () => {
      // Here we have a delta between latest and pending block amounts
      const latestAmount = 1000000000000000000n
      const pendingAmount = 2000000000000000000n

      const amountPostSimulation = undefined
      const activityNonce = 2n
      const portfolioNonce = undefined
      const simulationDelta = undefined

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        activityNonce,
        portfolioNonce
      )

      expect(result).toEqual({
        isPending: true,
        pendingBalance: 2000000000000000000n,
        pendingToBeConfirmed: 1000000000000000000n // Here we expect pendingToBeConfirmed property
      })
    })

    test('[PendingToBeSigned], [PendingToBeConfirmed] - Having difference between token latest and pending amounts and having AccOp (not broadcasted); should result in both badges pendingToBeSigned and pendingToBeConfirmed', async () => {
      // first latest/pending delta
      const latestAmount = 2000000000000000000n
      const pendingAmount = 3000000000000000000n

      const amountPostSimulation = 4000000000000000000n
      const activityNonce = 1n
      const portfolioNonce = 2n

      // AccOp simatulation delta
      const simulationDelta = 1000000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        activityNonce,
        portfolioNonce
      )

      expect(result).toEqual({
        isPending: true,
        pendingBalance: 4000000000000000000n,
        pendingToBeSigned: 1000000000000000000n, // Here we expect pendingToBeSigned property
        pendingToBeConfirmed: 1000000000000000000n // Here we expect pendingToBeConfirmed property
      })
    })

    test('[PendingToBeConfirmed] - Having difference between token latest and pending amounts and having AccOp the same time (broadcasted, but not confirmed); should result in `pendingToBeConfirmed` badge', async () => {
      // Here we have a delta between latest and pending block amounts
      const latestAmount = 2000000000000000000n
      const pendingAmount = 3000000000000000000n

      const amountPostSimulation = 4000000000000000000n

      // Here we know that having the same nonces, it means we have BroadcastedButNotConfirmed AccOp
      const activityNonce = 2n
      const portfolioNonce = 2n

      // We know the sumulatioh delta
      const simulationDelta = 1000000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        activityNonce,
        portfolioNonce
      )

      expect(result).toEqual({
        isPending: true,
        pendingBalance: 4000000000000000000n,
        // We expect the sum of both deltas here: `latestPendingDelta` + `simulationDelta`
        pendingToBeConfirmed: 2000000000000000000n // Here we expect pendingToBeConfirmed property
      })
    })
  })
})
