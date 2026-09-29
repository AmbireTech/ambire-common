import { encodeFunctionData, maxUint256, toFunctionSelector, zeroAddress, zeroHash } from 'viem'

import { describe, expect, jest, test } from '@jest/globals'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getBreak, getToken } from '../../utils'
import BlueBundlesV1Module from './'
import {
  blueBundlesV1MigrateBorrowPositionAbi,
  blueBundlesV1RepayAndWithdrawCollateralAbi,
  blueBundlesV1SupplyAbi,
  blueBundlesV1SupplyCollateralAndBorrowAbi,
  blueBundlesV1WithdrawAbi
} from './abi'

const BLUE_BUNDLES_V1 = '0x4D28D900e381eCE4B351302f1Abe588496793A2b'
const LOAN_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const COLLATERAL_TOKEN = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'

const accountOp: AccountOp = {
  id: 'blue-bundles-v1-id',
  accountAddr: '0x998f31d7403db347aed69186421e52ece492b36f',
  chainId: 8453n,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null
}

const marketParams = {
  loanToken: LOAN_TOKEN,
  collateralToken: COLLATERAL_TOKEN,
  oracle: '0x0000000000000000000000000000000000000001',
  irm: '0x0000000000000000000000000000000000000002',
  lltv: 800000000000000000n
} as const

const destinationMarketParams = {
  ...marketParams,
  oracle: '0x0000000000000000000000000000000000000003'
} as const

const tokenPermit = { kind: 0, data: '0x' } as const
const signedAuthorization = {
  signature: { v: 0, r: zeroHash, s: zeroHash },
  nonce: 0n,
  deadline: 0n
} as const
const referralFeePct = 0n
const deadline = maxUint256

const humanize = (data: `0x${string}`): IrCall =>
  BlueBundlesV1Module(accountOp, { to: BLUE_BUNDLES_V1, value: 0n, data })

describe('BlueBundlesV1', () => {
  test('uses the selectors from the verified Base deployment ABI', () => {
    expect(toFunctionSelector(blueBundlesV1SupplyCollateralAndBorrowAbi[0])).toBe('0xb1268765')
    expect(toFunctionSelector(blueBundlesV1RepayAndWithdrawCollateralAbi[0])).toBe('0x827d6bd8')
    expect(toFunctionSelector(blueBundlesV1SupplyAbi[0])).toBe('0xa4d5ece4')
    expect(toFunctionSelector(blueBundlesV1WithdrawAbi[0])).toBe('0xc0229fe8')
    expect(toFunctionSelector(blueBundlesV1MigrateBorrowPositionAbi[0])).toBe('0x9834e387')
  })

  test('humanizes supplying collateral and taking a loan', () => {
    const data = encodeFunctionData({
      abi: blueBundlesV1SupplyCollateralAndBorrowAbi,
      args: [
        marketParams,
        2n * 10n ** 8n,
        1000n * 10n ** 6n,
        maxUint256,
        tokenPermit,
        signedAuthorization,
        [],
        referralFeePct,
        zeroAddress,
        deadline
      ]
    })

    compareHumanizerVisualizations(
      [humanize(data)],
      [
        [
          getAction('Supply'),
          getToken(COLLATERAL_TOKEN, 2n * 10n ** 8n),
          getBreak(),
          getAction('Borrow'),
          getToken(LOAN_TOKEN, 1000n * 10n ** 6n)
        ]
      ]
    )
  })

  test('omits the collateral action from a borrow-only call', () => {
    const data = encodeFunctionData({
      abi: blueBundlesV1SupplyCollateralAndBorrowAbi,
      args: [
        marketParams,
        0n,
        1000n * 10n ** 6n,
        maxUint256,
        tokenPermit,
        signedAuthorization,
        [],
        referralFeePct,
        zeroAddress,
        deadline
      ]
    })

    compareHumanizerVisualizations(
      [humanize(data)],
      [[getAction('Borrow'), getToken(LOAN_TOKEN, 1000n * 10n ** 6n)]]
    )
  })

  test('humanizes repaying and withdrawing collateral', () => {
    const data = encodeFunctionData({
      abi: blueBundlesV1RepayAndWithdrawCollateralAbi,
      args: [
        marketParams,
        1000n * 10n ** 6n,
        0n,
        1000n * 10n ** 6n,
        2n * 10n ** 8n,
        maxUint256,
        tokenPermit,
        signedAuthorization,
        referralFeePct,
        zeroAddress,
        deadline
      ]
    })

    compareHumanizerVisualizations(
      [humanize(data)],
      [
        [
          getAction('Repay'),
          getToken(LOAN_TOKEN, 1000n * 10n ** 6n),
          getBreak(),
          getAction('Withdraw'),
          getToken(COLLATERAL_TOKEN, 2n * 10n ** 8n)
        ]
      ]
    )
  })

  test('shows the maximum repayment when repaying by shares', () => {
    const data = encodeFunctionData({
      abi: blueBundlesV1RepayAndWithdrawCollateralAbi,
      args: [
        marketParams,
        0n,
        maxUint256,
        1100n * 10n ** 6n,
        0n,
        maxUint256,
        tokenPermit,
        signedAuthorization,
        referralFeePct,
        zeroAddress,
        deadline
      ]
    })

    compareHumanizerVisualizations(
      [humanize(data)],
      [[getAction('Repay up to'), getToken(LOAN_TOKEN, 1100n * 10n ** 6n)]]
    )
  })

  test('humanizes supplying loan assets', () => {
    const data = encodeFunctionData({
      abi: blueBundlesV1SupplyAbi,
      args: [marketParams, 1000n * 10n ** 6n, tokenPermit, referralFeePct, zeroAddress, deadline]
    })

    compareHumanizerVisualizations(
      [humanize(data)],
      [[getAction('Supply'), getToken(LOAN_TOKEN, 1000n * 10n ** 6n)]]
    )
  })

  test('humanizes withdrawing loan assets', () => {
    const data = encodeFunctionData({
      abi: blueBundlesV1WithdrawAbi,
      args: [
        marketParams,
        1000n * 10n ** 6n,
        0n,
        signedAuthorization,
        [],
        referralFeePct,
        zeroAddress,
        deadline
      ]
    })

    compareHumanizerVisualizations(
      [humanize(data)],
      [[getAction('Withdraw'), getToken(LOAN_TOKEN, 1000n * 10n ** 6n)]]
    )
  })

  test('does not present shares as a token amount when withdrawing by shares', () => {
    const data = encodeFunctionData({
      abi: blueBundlesV1WithdrawAbi,
      args: [marketParams, 0n, 500n, signedAuthorization, [], referralFeePct, zeroAddress, deadline]
    })

    compareHumanizerVisualizations([humanize(data)], [[getAction('Withdraw supplied funds')]])
  })

  test('humanizes moving a borrowing position', () => {
    const data = encodeFunctionData({
      abi: blueBundlesV1MigrateBorrowPositionAbi,
      args: [
        marketParams,
        destinationMarketParams,
        maxUint256,
        signedAuthorization,
        [],
        referralFeePct,
        zeroAddress,
        deadline
      ]
    })

    compareHumanizerVisualizations([humanize(data)], [[getAction('Move borrowing position')]])
  })

  test('leaves unrelated calldata untouched', () => {
    const call: IrCall = { to: BLUE_BUNDLES_V1, value: 0n, data: '0x12345678' }

    expect(BlueBundlesV1Module(accountOp, call)).toBe(call)
  })

  test('does not overwrite an earlier humanization', () => {
    const fullVisualization = [getAction('Existing action')]
    const call: IrCall = {
      to: BLUE_BUNDLES_V1,
      value: 0n,
      data: `${toFunctionSelector(blueBundlesV1SupplyAbi[0])}`,
      fullVisualization
    }

    expect(BlueBundlesV1Module(accountOp, call)).toBe(call)
    expect(call.fullVisualization).toBe(fullVisualization)
  })

  test('leaves malformed matching calldata untouched', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const call: IrCall = {
      to: BLUE_BUNDLES_V1,
      value: 0n,
      data: toFunctionSelector(blueBundlesV1SupplyAbi[0])
    }

    try {
      expect(BlueBundlesV1Module(accountOp, call)).toBe(call)
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to decode BlueBundlesV1 calldata',
        expect.anything()
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})
