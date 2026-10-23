import { encodeFunctionData, getAddress, maxUint256 } from 'viem'

import { describe, expect, test } from '@jest/globals'

import { generalAdapterModule } from '.'
import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { getAction, getLegacyVisualization } from '../../utils'
import {
  erc20TransferAbi,
  erc20TransferFromAbi,
  erc4626DepositAbi,
  erc4626MintAbi,
  erc4626RedeemAbi,
  erc4626WithdrawAbi,
  morphoBorrowAbi,
  morphoFlashLoanAbi,
  morphoRepayAbi,
  morphoSupplyCollateralAbi,
  morphoWithdrawCollateralAbi,
  nativeTransferAbi,
  permit2TransferFromAbi,
  unwrapNativeAbi,
  wrapNativeAbi
} from '../Bundler3/generalAdapter'

const OWNER = '0xd8293ad21678c6f09da139b4b62d38e514a03b78'
const STRANGER = '0x9999999999999999999999999999999999999999'
const ADAPTER = '0xb98c948cfa24072e58935bc004a8a7b376ae746a'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const CBBTC = '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'
const VAULT = '0xbeef010f9cb27031ad51e3333f9af9c6b1228183'

const accountOp = { accountAddr: OWNER, chainId: 8453n, calls: [] } as unknown as AccountOp
const market = {
  loanToken: USDC,
  collateralToken: CBBTC,
  oracle: '0x663becd10dae6c4a3dcd89f1d76c1174199639b9',
  irm: '0x46415998764c29ab2a25cbea6254146d50d22687',
  lltv: 86145408065551n
} as const

const getCall = (data: string): IrCall => ({ to: ADAPTER, value: 0n, data })
const humanize = (data: string) => generalAdapterModule(accountOp, getCall(data))

const getIntentText = (call: IrCall) =>
  call.fullVisualization?.intent.map((item) =>
    item.type === 'token' ? `${item.address}:${item.value}` : (item.content ?? item.address)
  )

describe('generalAdapterModule', () => {
  describe('describes each function of the adapter', () => {
    test.each([
      [
        'erc20TransferFrom',
        encodeFunctionData({ abi: erc20TransferFromAbi, args: [USDC, ADAPTER, 150n] }),
        ['Transfer', `${USDC}:150`, 'To', ADAPTER]
      ],
      [
        'erc20Transfer',
        encodeFunctionData({ abi: erc20TransferAbi, args: [USDC, OWNER, maxUint256] }),
        ['Transfer', `${USDC}:${maxUint256}`, 'To', OWNER]
      ],
      [
        'permit2TransferFrom',
        encodeFunctionData({ abi: permit2TransferFromAbi, args: [USDC, ADAPTER, 7n] }),
        ['Transfer', `${USDC}:7`, 'To', ADAPTER]
      ],
      [
        'nativeTransfer',
        encodeFunctionData({ abi: nativeTransferAbi, args: [OWNER, 9n] }),
        ['Transfer', `0x0000000000000000000000000000000000000000:9`, 'To', OWNER]
      ],
      [
        'morphoSupplyCollateral',
        encodeFunctionData({
          abi: morphoSupplyCollateralAbi,
          args: [market, 100000n, OWNER, '0x']
        }),
        ['Supply', `${CBBTC}:100000`]
      ],
      [
        'morphoBorrow',
        encodeFunctionData({ abi: morphoBorrowAbi, args: [market, 50n, 0n, 0n, OWNER] }),
        ['Borrow', `${USDC}:50`]
      ],
      [
        'morphoWithdrawCollateral',
        encodeFunctionData({ abi: morphoWithdrawCollateralAbi, args: [market, 200000n, OWNER] }),
        ['Withdraw', `${CBBTC}:200000`]
      ],
      [
        'morphoFlashLoan',
        encodeFunctionData({ abi: morphoFlashLoanAbi, args: [USDC, 1000n, '0x'] }),
        ['Execute flash loan for', `${USDC}:1000`]
      ]
    ])('%s', (_, data, expectedIntent) => {
      const call = humanize(data)

      expect(getIntentText(call)).toEqual(expectedIntent)
      expect(call.fullVisualization?.fields).toEqual([])
    })

    test.each([
      ['wrapNative', encodeFunctionData({ abi: wrapNativeAbi, args: [5n] }), 'Wrap'],
      ['unwrapNative', encodeFunctionData({ abi: unwrapNativeAbi, args: [5n] }), 'Unwrap'],
      [
        'erc4626Mint',
        encodeFunctionData({ abi: erc4626MintAbi, args: [VAULT, 1n, 1n, OWNER] }),
        'Supply to vault'
      ],
      [
        'erc4626Deposit',
        encodeFunctionData({ abi: erc4626DepositAbi, args: [VAULT, 1n, 1n, OWNER] }),
        'Mint from vault'
      ],
      [
        'erc4626Withdraw',
        encodeFunctionData({ abi: erc4626WithdrawAbi, args: [VAULT, 1n, 1n, OWNER, OWNER] }),
        'Withdraw from vault'
      ],
      [
        'erc4626Redeem',
        encodeFunctionData({ abi: erc4626RedeemAbi, args: [VAULT, 1n, 1n, OWNER, OWNER] }),
        'Withdraw from vault'
      ]
    ])('%s', (_, data, expectedAction) => {
      const call = humanize(data)

      expect(call.fullVisualization?.intent[0]).toMatchObject({
        type: 'action',
        content: expectedAction
      })
    })
  })

  test('puts no line break in the intent, the bundle view adds its own', () => {
    const call = humanize(encodeFunctionData({ abi: erc20TransferAbi, args: [USDC, OWNER, 1n] }))

    expect(call.fullVisualization?.intent.some((item) => item.type === 'break')).toBe(false)
  })

  test('shows the amount a repay by shares will pay', () => {
    // 150 USDC of shares at a maximum price of 1.01 per share
    const call = humanize(
      encodeFunctionData({
        abi: morphoRepayAbi,
        args: [market, 0n, 150_000000_000000n, 1_010000000000000000000n, OWNER, '0x']
      })
    )

    expect(getIntentText(call)).toEqual(['Repay', `${USDC}:151500000`])
  })

  test('decodes calldata that is missing its last words, as the chain would read it', () => {
    const data = encodeFunctionData({ abi: erc20TransferAbi, args: [USDC, OWNER, 5n] })
    const call = humanize(data.slice(0, -64))

    expect(getIntentText(call)).toEqual(['Transfer', `${USDC}:0`, 'To', OWNER])
  })

  describe('warnings', () => {
    test('warns when a supply is made for another address', () => {
      const call = humanize(
        encodeFunctionData({
          abi: morphoSupplyCollateralAbi,
          args: [market, 100000n, STRANGER, '0x']
        })
      )

      expect(call.warnings).toEqual([
        expect.objectContaining({
          code: 'Morpho_diff_addr',
          content: expect.stringContaining(STRANGER)
        })
      ])
    })

    test.each([
      [
        'borrow',
        encodeFunctionData({ abi: morphoBorrowAbi, args: [market, 50n, 0n, 0n, STRANGER] })
      ],
      [
        'repay',
        encodeFunctionData({
          abi: morphoRepayAbi,
          args: [market, 5n, 0n, 0n, STRANGER, '0x']
        })
      ],
      [
        'withdraw collateral',
        encodeFunctionData({ abi: morphoWithdrawCollateralAbi, args: [market, 5n, STRANGER] })
      ],
      [
        'vault deposit',
        encodeFunctionData({ abi: erc4626DepositAbi, args: [VAULT, 1n, 1n, STRANGER] })
      ]
    ])('warns when a %s is made for another address', (_, data) => {
      expect(humanize(data).warnings?.map((warning) => warning.code)).toEqual(['Morpho_diff_addr'])
    })

    test('does not warn when the action is for the account itself', () => {
      const call = humanize(
        encodeFunctionData({ abi: morphoBorrowAbi, args: [market, 50n, 0n, 0n, OWNER] })
      )

      expect(call.warnings).toEqual([])
    })

    test('does not warn for the account in another letter case', () => {
      const checksummedAccountOp = {
        ...accountOp,
        accountAddr: getAddress(OWNER)
      } as unknown as AccountOp
      const call = generalAdapterModule(
        checksummedAccountOp,
        getCall(encodeFunctionData({ abi: morphoBorrowAbi, args: [market, 50n, 0n, 0n, OWNER] }))
      )

      expect(call.warnings).toEqual([])
    })
  })

  describe('leaves a call to the other modules', () => {
    test('when another module already described it', () => {
      const described = {
        ...getCall(encodeFunctionData({ abi: erc20TransferAbi, args: [USDC, OWNER, 1n] })),
        fullVisualization: getLegacyVisualization([getAction('Something else')])
      }

      expect(generalAdapterModule(accountOp, described)).toBe(described)
    })

    test('when the function is not one of the adapter', () => {
      const call = getCall('0xdeadbeef')

      expect(generalAdapterModule(accountOp, call)).toBe(call)
    })

    test('when there is no calldata', () => {
      const call = getCall('0x')

      expect(generalAdapterModule(accountOp, call)).toBe(call)
    })

    test('when the calldata of a Morpho function cannot be decoded', () => {
      const data = encodeFunctionData({
        abi: morphoSupplyCollateralAbi,
        args: [market, 1n, OWNER, '0x']
      })
      // A Morpho call has a struct, and cutting it makes the decoding fail
      const call = getCall(data.slice(0, 20))

      expect(generalAdapterModule(accountOp, call)).toBe(call)
    })
  })
})
