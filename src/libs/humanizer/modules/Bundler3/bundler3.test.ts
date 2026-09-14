import { describe, expect, test } from '@jest/globals'

import { encodeFunctionData } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getBreak, getLabel, getToken } from '../../utils'
import Bundler3Module from '.'
import {
  decodeGeneralAdapterCall,
  erc4626DepositAbi,
  morphoBorrowAbi,
  morphoWithdrawCollateralAbi
} from './generalAdapter'

const BUNDLER3 = '0x6BFd8137e702540E7A42B74177A99878FCAE1B0'
const LOAN_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const COLLATERAL_TOKEN = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const VAULT = '0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183'
const RECEIVER = '0x998f31d7403db347aed69186421e52ece492b36f'

const accountOp: AccountOp = {
  id: 'bundler3-id',
  accountAddr: RECEIVER,
  chainId: 1n,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null
}

const marketParams = {
  loanToken: LOAN_TOKEN as `0x${string}`,
  collateralToken: COLLATERAL_TOKEN as `0x${string}`,
  oracle: '0x0000000000000000000000000000000000000001' as `0x${string}`,
  irm: '0x0000000000000000000000000000000000000002' as `0x${string}`,
  lltv: 800000000000000000n
}

// this calldata would still execute onchain - the missing trailing words are read as zeroes
// by the EVM - so the humanizer has to decode it the same way and still show the "different
// address" warning, rather than silently dropping the whole call
describe('Bundler3 generalAdapter short calldata protection', () => {
  // the receiver is the last static word, so cutting it off zeroes it out - the call still
  // decodes, and now the humanizer correctly warns that the receiver differs from the account
  test('morphoBorrow with the trailing receiver word missing still decodes and warns', () => {
    const fullData = encodeFunctionData({
      abi: morphoBorrowAbi,
      args: [marketParams, 10n ** 18n, 0n, 0n, accountOp.accountAddr as `0x${string}`]
    })
    const shortData = fullData.slice(0, -64) as `0x${string}`
    const call: IrCall = { to: BUNDLER3, value: 0n, data: shortData }

    const decoded = decodeGeneralAdapterCall(accountOp.accountAddr, call)

    compareHumanizerVisualizations(
      [decoded],
      [[getBreak(), getAction('Borrow'), getToken(LOAN_TOKEN, 10n ** 18n)]]
    )
    expect(decoded.warnings?.[0]?.code).toBe('Morpho_diff_addr')
  })

  test('morphoWithdrawCollateral to a different address still warns when short', () => {
    const otherReceiver = '0x000000000000000000000000000000000000dEaD'
    const fullData = encodeFunctionData({
      abi: morphoWithdrawCollateralAbi,
      args: [marketParams, 10n ** 18n, otherReceiver as `0x${string}`]
    })
    const shortData = fullData.slice(0, -64) as `0x${string}`
    const call: IrCall = { to: BUNDLER3, value: 0n, data: shortData }

    const decoded = decodeGeneralAdapterCall(accountOp.accountAddr, call)

    expect(decoded.warnings?.length).toBe(1)
    expect(decoded.warnings?.[0]?.code).toBe('Morpho_diff_addr')
  })

  test('erc4626Deposit with the trailing receiver word missing still decodes', () => {
    const fullData = encodeFunctionData({
      abi: erc4626DepositAbi,
      args: [VAULT as `0x${string}`, 10n ** 18n, 0n, accountOp.accountAddr as `0x${string}`]
    })
    const shortData = fullData.slice(0, -64) as `0x${string}`
    const call: IrCall = { to: BUNDLER3, value: 0n, data: shortData }

    const decoded = decodeGeneralAdapterCall(accountOp.accountAddr, call)

    compareHumanizerVisualizations(
      [decoded],
      [[getBreak(), getAction('Mint from vault'), getAddressVisualization(VAULT)]]
    )
  })
})

describe('Bundler3Module (multicall) short calldata protection', () => {
  const multicallAbi = [
    {
      type: 'function',
      name: 'multicall',
      inputs: [
        {
          name: 'bundle',
          type: 'tuple[]',
          components: [
            { name: 'to', type: 'address' },
            { name: 'data', type: 'bytes' },
            { name: 'value', type: 'uint256' },
            { name: 'skipRevert', type: 'bool' },
            { name: 'callbackHash', type: 'bytes32' }
          ]
        }
      ],
      outputs: [],
      stateMutability: 'payable'
    }
  ] as const

  test('a bundled morphoBorrow call with short inner calldata still shows the loan amount', () => {
    const innerData = encodeFunctionData({
      abi: morphoBorrowAbi,
      args: [marketParams, 10n ** 18n, 0n, 0n, accountOp.accountAddr as `0x${string}`]
    }).slice(0, -64) as `0x${string}`

    const data = encodeFunctionData({
      abi: multicallAbi,
      args: [
        [
          {
            to: VAULT as `0x${string}`,
            data: innerData,
            value: 0n,
            skipRevert: false,
            callbackHash: `0x${'0'.repeat(64)}` as `0x${string}`
          }
        ]
      ]
    })
    const call: IrCall = { to: BUNDLER3, value: 0n, data }

    const irCall = Bundler3Module(accountOp, call)

    compareHumanizerVisualizations(
      [irCall],
      [[getAction('Take'), getToken(LOAN_TOKEN, 10n ** 18n), getLabel('loan')]]
    )
  })
})
