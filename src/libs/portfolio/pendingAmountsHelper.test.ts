import { expect } from '@jest/globals'
import { AccountOp } from '../accountOp/accountOp'
import { AccountOpStatus } from '../accountOp/types'
import { calculatePendingAmounts } from './pendingAmountsHelper'

describe('Portfolio -> Pending Amounts Helper', () => {
  describe('calculatePendingAmounts', () => {
    test('[PendingToBeSigned] - Having simulation and the AccOp is not broadcasted yet; should result in `pendingToBeSigned` badge', async () => {
      const latestAmount = 2000000000000000000n
      const pendingAmount = 2000000000000000000n
      const amountPostSimulation = 1000000000000000000n

      const simulationDelta = -1000000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        // having simulation, but the txn is not broadcasted yet, and that's why the status is not set to BroadcastedButNotConfirmed.
        {} as AccountOp
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

      const simulationDelta = -1000000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        // Once we broadcast the txn, we set BroadcastedButNotConfirmed status to the simulated AccountOp
        { status: AccountOpStatus.BroadcastedButNotConfirmed } as AccountOp
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

      const result = calculatePendingAmounts(latestAmount, pendingAmount, amountPostSimulation)

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

      // AccOp simatulation delta
      const simulationDelta = 1000000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        // having simulation, but the txn is not broadcasted yet, and that's why the status is not set to BroadcastedButNotConfirmed.
        {} as AccountOp
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

      // We know the sumulatioh delta
      const simulationDelta = 1000000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        // Once we broadcast the txn, we set BroadcastedButNotConfirmed status to the simulated AccountOp
        { status: AccountOpStatus.BroadcastedButNotConfirmed } as AccountOp
      )

      expect(result).toEqual({
        isPending: true,
        pendingBalance: 4000000000000000000n,
        // We expect the sum of both deltas here: `latestPendingDelta` + `simulationDelta`
        pendingToBeConfirmed: 2000000000000000000n // Here we expect pendingToBeConfirmed property
      })
    })

    test('[PendingDelivery] - Having only an in-progress swap or bridge; should result in `pendingDelivery` badge', async () => {
      const latestAmount = 2000000000000000000n
      const pendingAmount = 2000000000000000000n
      const pendingDelivery = 500000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        undefined,
        undefined,
        undefined,
        pendingDelivery
      )

      expect(result).toEqual({
        isPending: true,
        pendingBalance: 2500000000000000000n,
        pendingDelivery: 500000000000000000n
      })
    })

    test('[PendingDelivery] - Receiving a token the account does not hold yet; should start from a zero balance', async () => {
      const result = calculatePendingAmounts(0n, 0n, undefined, undefined, undefined, 1000n)

      expect(result).toEqual({ isPending: true, pendingBalance: 1000n, pendingDelivery: 1000n })
    })

    test('[PendingDelivery] - Sending tokens with a CoW Swap order; should reduce the pending balance', async () => {
      const result = calculatePendingAmounts(3000n, 3000n, undefined, undefined, undefined, -1000n)

      expect(result).toEqual({ isPending: true, pendingBalance: 2000n, pendingDelivery: -1000n })
    })

    test('[PendingDelivery] - Sending more than the balance; should not result in a negative pending balance', async () => {
      const result = calculatePendingAmounts(500n, 500n, undefined, undefined, undefined, -1000n)

      expect(result).toEqual({ isPending: true, pendingBalance: 0n, pendingDelivery: -1000n })
    })

    test('[PendingDelivery] - A zero delivery; should not result in a pending state', async () => {
      expect(calculatePendingAmounts(500n, 500n, undefined, undefined, undefined, 0n)).toBeNull()
    })

    test('[PendingToBeSigned], [PendingDelivery] - Having an AccOp (not broadcasted) and an in-progress swap or bridge; should result in both badges, with the delivery added to the simulated balance', async () => {
      const latestAmount = 2000000000000000000n
      const pendingAmount = 2000000000000000000n
      const amountPostSimulation = 1000000000000000000n
      const simulationDelta = -1000000000000000000n
      const pendingDelivery = 300000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        amountPostSimulation,
        simulationDelta,
        {} as AccountOp,
        pendingDelivery
      )

      expect(result).toEqual({
        isPending: true,
        pendingBalance: 1300000000000000000n,
        pendingToBeSigned: -1000000000000000000n,
        pendingDelivery: 300000000000000000n
      })
    })

    test('[PendingToBeConfirmed], [PendingDelivery] - Having a latest/pending block delta and an in-progress swap or bridge; should add the delivery to the pending block amount', async () => {
      const latestAmount = 1000000000000000000n
      const pendingAmount = 2000000000000000000n
      const pendingDelivery = 500000000000000000n

      const result = calculatePendingAmounts(
        latestAmount,
        pendingAmount,
        undefined,
        undefined,
        undefined,
        pendingDelivery
      )

      expect(result).toEqual({
        isPending: true,
        pendingBalance: 2500000000000000000n,
        pendingToBeConfirmed: 1000000000000000000n,
        pendingDelivery: 500000000000000000n
      })
    })
  })
})
