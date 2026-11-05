import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { Account, AccountOnchainState } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../accountOp/accountOp'
import {
  AmbireEstimation,
  FullEstimation,
  FullEstimationSummary,
  ProviderEstimation
} from '../estimate/interfaces'
import { getBroadcastGas } from '../gasPrice/gasPrice'
import { TokenResult } from '../portfolio'
import { EOA7702 } from './EOA7702'

const accountAddr = '0x1111111111111111111111111111111111111111'
const portalAddr = '0x49048044D57e1C92A77f79988d21Fa8fAF74E97e'

const account = {
  addr: accountAddr,
  associatedKeys: [accountAddr],
  initialPrivileges: [],
  creation: null,
  preferences: { label: 'Account', pfp: accountAddr }
} as Account

const network = { chainId: 1n, has7702: true } as Network

const smarterAccountState = { isEOA: true, isSmarterEoa: true } as AccountOnchainState
const notSmarterAccountState = { isEOA: true, isSmarterEoa: false } as AccountOnchainState

const nativeToken = {
  address: ZeroAddress,
  amount: 10n ** 18n,
  symbol: 'ETH',
  decimals: 18,
  chainId: 1n,
  flags: { onGasTank: false }
} as TokenResult

const getOp = (numberOfCalls: number): AccountOp =>
  ({
    accountAddr,
    chainId: 1n,
    nonce: 0n,
    signature: null,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    calls: Array.from({ length: numberOfCalls }, (_, i) => ({
      id: `call-${i}`,
      to: portalAddr,
      value: 0n,
      data: '0x8c3152e9'
    }))
  }) as AccountOp

const providerEstimation: ProviderEstimation = { gasUsed: 866755n, feePaymentOptions: [] }
const ambireEstimation: AmbireEstimation = {
  gasUsed: 916740n,
  deploymentGas: 0n,
  feePaymentOptions: [],
  ambireAccountNonce: 0,
  flags: {}
}
// the error the ambire estimation returns when the inner call requires
// more gas than the gas limits the estimation retries with
const notEnoughGasError = new Error('Transaction cannot be sent because of a contract error.', {
  cause: 'SafeCall: Not enough gas'
})
const oogError = new Error('Transaction invalid: out of gas', { cause: 'OOG' })
const providerError = new Error('Transaction cannot be sent because it will revert onchain.')

const getFullEstimation = (
  provider: FullEstimation['provider'],
  ambire: FullEstimation['ambire']
): FullEstimation => ({ provider, ambire, bundler: null, flags: {} })

describe('EOA7702', () => {
  describe('getEstimationCriticalError for a smarter EOA', () => {
    const smarterEoa = new EOA7702(account, network, smarterAccountState, true)

    test('allows a single call when only the ambire estimation fails because of insufficient gas limits', () => {
      const estimation = getFullEstimation(providerEstimation, notEnoughGasError)

      expect(smarterEoa.getEstimationCriticalError(estimation, getOp(1))).toBe(null)
    })

    test('blocks a single call when the ambire estimation says the transaction is out of gas', () => {
      const estimation = getFullEstimation(providerEstimation, oogError)

      expect(smarterEoa.getEstimationCriticalError(estimation, getOp(1))).toBe(oogError)
    })

    test('blocks a single call with the ambire error when both estimations fail', () => {
      const estimation = getFullEstimation(providerError, notEnoughGasError)

      expect(smarterEoa.getEstimationCriticalError(estimation, getOp(1))).toBe(notEnoughGasError)
    })

    test('blocks a single call when the ambire estimation fails and there is no provider estimation', () => {
      const estimation = getFullEstimation(null, notEnoughGasError)

      expect(smarterEoa.getEstimationCriticalError(estimation, getOp(1))).toBe(notEnoughGasError)
    })

    test('blocks a batch when the ambire estimation fails even if the provider estimation passes', () => {
      const estimation = getFullEstimation(providerEstimation, notEnoughGasError)

      expect(smarterEoa.getEstimationCriticalError(estimation, getOp(2))).toBe(notEnoughGasError)
    })

    test('allows a single call and a batch when both estimations pass', () => {
      const estimation = getFullEstimation(providerEstimation, ambireEstimation)

      expect(smarterEoa.getEstimationCriticalError(estimation, getOp(1))).toBe(null)
      expect(smarterEoa.getEstimationCriticalError(estimation, getOp(2))).toBe(null)
    })
  })

  describe('getEstimationCriticalError for an EOA that is not smarter yet', () => {
    const eoa = new EOA7702(account, network, notSmarterAccountState, true)

    test('allows a single call when only the ambire estimation fails', () => {
      const estimation = getFullEstimation(providerEstimation, notEnoughGasError)

      expect(eoa.getEstimationCriticalError(estimation, getOp(1))).toBe(null)
    })

    test('blocks a single call with the ambire error when all estimations fail', () => {
      const estimation = { ...getFullEstimation(providerError, notEnoughGasError), bundler: providerError }

      expect(eoa.getEstimationCriticalError(estimation, getOp(1))).toBe(notEnoughGasError)
    })
  })

  describe('getGasUsed for a smarter EOA paying in native', () => {
    const smarterEoa = new EOA7702(account, network, smarterAccountState, true)
    const getSummary = (
      summary: Pick<FullEstimationSummary, 'providerEstimation' | 'ambireEstimation'>
    ): FullEstimationSummary => ({ ...summary, flags: {}, updatedAt: Date.now() })

    test('uses the provider estimation when the ambire estimation has failed', () => {
      const summary = getSummary({ providerEstimation })

      expect(smarterEoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(1) })).toBe(
        providerEstimation.gasUsed
      )
    })

    test('prefers the provider estimation when both estimations pass', () => {
      const summary = getSummary({ providerEstimation, ambireEstimation })

      expect(smarterEoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(1) })).toBe(
        providerEstimation.gasUsed
      )
    })

    test('uses the ambire estimation and adds the broadcast gas when the provider estimation has failed', () => {
      const op = getOp(1)
      const summary = getSummary({ ambireEstimation })

      expect(smarterEoa.getGasUsed(summary, { feeToken: nativeToken, op })).toBe(
        ambireEstimation.gasUsed + getBroadcastGas(smarterEoa, op)
      )
    })

    test('returns 0 when both estimations have failed so the transaction cannot be broadcast', () => {
      const summary = getSummary({})

      expect(smarterEoa.getGasUsed(summary, { feeToken: nativeToken, op: getOp(1) })).toBe(0n)
    })
  })
})
