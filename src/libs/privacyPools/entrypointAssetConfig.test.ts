import { PRIVACY_POOLS_DEPOSIT_CHIPS } from '../../consts/privacyPools'
import { getDepositAmountWithVettingFee, getMaxDepositPoolValue } from './entrypointAssetConfig'

/** What the entrypoint puts into the pool: it rounds its fee down. */
const getDepositAmountAfterVettingFee = (amount: bigint, vettingFeeBPS: bigint) =>
  amount - (amount * vettingFeeBPS) / 10_000n

/** The 0xBow website's `calculateInitialDeposit`, as written there. */
const calculateInitialDeposit = (inputAmount: bigint, feeBps: bigint) =>
  (inputAmount * 10n ** 18n) / (10n ** 18n - (feeBps * 10n ** 18n) / 100n / 100n)

// 0.5%, the Ethereum pools' fee, and fees that round differently
const VETTING_FEES_BPS = [50n, 1n, 33n, 999n]

const ODD_AMOUNTS = [1n, 7n, 199n, 12_345n, 10n ** 18n + 3n, 123_456_789_012_345_678n]

describe('getDepositAmountWithVettingFee', () => {
  const amounts = [...Object.values(PRIVACY_POOLS_DEPOSIT_CHIPS).flat(), ...ODD_AMOUNTS]

  it.each(VETTING_FEES_BPS)('puts exactly the asked amount into the pool at %s bps', (fee) => {
    amounts.forEach((poolValue) => {
      const depositAmount = getDepositAmountWithVettingFee(poolValue, fee)

      expect({
        poolValue,
        fee,
        result: getDepositAmountAfterVettingFee(depositAmount, fee)
      }).toEqual({ poolValue, fee, result: poolValue })
    })
  })

  it.each(VETTING_FEES_BPS)('asks for what the 0xBow website asks for at %s bps', (fee) => {
    amounts.forEach((poolValue) => {
      expect({ poolValue, fee, result: getDepositAmountWithVettingFee(poolValue, fee) }).toEqual({
        poolValue,
        fee,
        result: calculateInitialDeposit(poolValue, fee)
      })
    })
  })
})

describe('getMaxDepositPoolValue', () => {
  const balances = [...Object.values(PRIVACY_POOLS_DEPOSIT_CHIPS).flat(), ...ODD_AMOUNTS]

  it.each(VETTING_FEES_BPS)('never asks for more than the balance at %s bps', (fee) => {
    balances.forEach((balance) => {
      const depositAmount = getDepositAmountWithVettingFee(
        getMaxDepositPoolValue(balance, fee),
        fee
      )

      expect({ balance, fee, isWithinBalance: depositAmount <= balance }).toEqual({
        balance,
        fee,
        isWithinBalance: true
      })
    })
  })
})
