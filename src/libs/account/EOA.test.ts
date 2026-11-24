import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import { AmbireEstimation, FullEstimationSummary, ProviderEstimation } from '../estimate/interfaces'
import { TokenResult } from '../portfolio'
import { EOA, TXN_BASE_GAS } from './EOA'

const accountAddr = '0x1111111111111111111111111111111111111111'
const tokenAddr = '0x2222222222222222222222222222222222222222'

const account = {
  addr: accountAddr,
  associatedKeys: [accountAddr],
  initialPrivileges: [],
  creation: null,
  preferences: { label: 'Account', pfp: accountAddr }
} as Account

const network = { chainId: 42161n, has7702: false } as Network
const accountState = { isEOA: true, isSmarterEoa: false, eoaNonce: 0n } as AccountOnchainState

const nativeToken = {
  address: ZeroAddress,
  amount: 10n ** 18n,
  symbol: 'ETH',
  decimals: 18,
  chainId: 42161n,
  flags: { onGasTank: false }
} as TokenResult

const getOp = (numberOfCalls: number, data = '0x095ea7b3'): AccountOp =>
  ({
    accountAddr,
    chainId: 42161n,
    nonce: 0n,
    signature: null,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    calls: Array.from({ length: numberOfCalls }, (_, i) => ({
      id: `call-${i}`,
      to: tokenAddr,
      value: data === '0x' ? 1n : 0n,
      data
    }))
  }) as AccountOp

const getSummary = (
  summary: Pick<FullEstimationSummary, 'providerEstimation' | 'ambireEstimation'>
): FullEstimationSummary => ({ ...summary, flags: {}, updatedAt: Date.now() })

const getProviderEstimation = (gasUsed: bigint): ProviderEstimation => ({
  gasUsed,
  feePaymentOptions: []
})

const getAmbireEstimation = (gasUsed: bigint): AmbireEstimation => ({
  gasUsed,
  deploymentGas: 0n,
  feePaymentOptions: [],
  ambireAccountNonce: 0,
  flags: {}
})

describe('EOA', () => {
  const eoa = new EOA(account, network, accountState, false)

  describe('getGasUsed', () => {
    test('a batch is charged the base txn cost of every txn it is broadcast as', () => {
      const op = getOp(2)
      const summary = getSummary({
        providerEstimation: getProviderEstimation(50000n),
        ambireEstimation: getAmbireEstimation(80000n)
      })

      expect(eoa.shouldBroadcastCallsSeparately(op)).toBe(true)
      expect(eoa.getGasUsed(summary, { feeToken: nativeToken, op })).toBe(
        80000n + TXN_BASE_GAS * 2n
      )
    })

    test('the base txn cost grows with the number of calls in the batch', () => {
      const summary = getSummary({
        providerEstimation: getProviderEstimation(50000n),
        ambireEstimation: getAmbireEstimation(80000n)
      })

      const twoCalls = eoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(2) })
      const threeCalls = eoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(3) })

      expect(threeCalls - twoCalls).toBe(TXN_BASE_GAS)
    })

    test('a batch keeps the provider estimation when it is higher than the calls with their base cost', () => {
      const summary = getSummary({
        providerEstimation: getProviderEstimation(500000n),
        ambireEstimation: getAmbireEstimation(80000n)
      })

      expect(eoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(2) })).toBe(500000n)
    })

    test('a single call is not charged an extra base txn cost', () => {
      const summary = getSummary({
        providerEstimation: getProviderEstimation(50000n),
        ambireEstimation: getAmbireEstimation(80000n)
      })

      expect(eoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(1) })).toBe(80000n)
    })

    test('a single native transfer uses only the provider estimation', () => {
      const summary = getSummary({
        providerEstimation: getProviderEstimation(21000n),
        ambireEstimation: getAmbireEstimation(80000n)
      })

      expect(eoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(1, '0x') })).toBe(21000n)
    })

    test('a batch without an ambire estimation falls back to the provider estimation', () => {
      const summary = getSummary({ providerEstimation: getProviderEstimation(50000n) })

      expect(eoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(2) })).toBe(50000n)
    })

    test('returns 0 without a provider estimation so the transaction cannot be broadcast', () => {
      const summary = getSummary({ ambireEstimation: getAmbireEstimation(80000n) })

      expect(eoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(2) })).toBe(0n)
    })
  })
})
