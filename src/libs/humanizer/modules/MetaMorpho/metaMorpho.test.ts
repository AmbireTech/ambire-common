import { encodeFunctionData, maxUint256, parseAbi } from 'viem'

import MetaMorphoModule from '.'
import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import {
  getAction,
  getAddressVisualization,
  getBreak,
  getLabel,
  getToken,
  getUnlimitedApprovalWarning
} from '../../utils'

// real MetaMorpho vault on Ethereum
const VAULT_ADDRESS = '0xdd0f28e19C1780eb6396170735D45153D261490d'
const SPENDER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

const accountOp: AccountOp = {
  id: 'test',
  accountAddr: '0x6969174FD72466430a46e18234D0b530c9FD5f49',
  chainId: 1n,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null
}

describe('MetaMorpho', () => {
  test('approve, wrapped in a self multicall', () => {
    const call: IrCall = {
      to: VAULT_ADDRESS,
      value: 0n,
      data: '0xac9650d80000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000'
    }
    const expectedVisualization = [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(VAULT_ADDRESS, 1000000000000000000n),
      getLabel('to'),
      getAddressVisualization(SPENDER)
    ]
    const irCalls = [call].map((c) => MetaMorphoModule(accountOp, c))
    compareHumanizerVisualizations(irCalls, [expectedVisualization])
  })

  test('approve + deposit, wrapped in a single multicall, separated by a break line', () => {
    const call: IrCall = {
      to: VAULT_ADDRESS,
      value: 0n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000446e553f650000000000000000000000000000000000000000000000000de0b6b3a76400000000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f4900000000000000000000000000000000000000000000000000000000'
    }
    const expectedVisualization = [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(VAULT_ADDRESS, 1000000000000000000n),
      getLabel('to'),
      getAddressVisualization(SPENDER),
      getBreak(),
      getAction('Deposit into vault'),
      getToken(VAULT_ADDRESS, 1000000000000000000n)
    ]
    const irCalls = [call].map((c) => MetaMorphoModule(accountOp, c))
    compareHumanizerVisualizations(irCalls, [expectedVisualization])
  })

  test('withdraw, wrapped in a self multicall, includes the withdrawn amount', () => {
    const call: IrCall = {
      to: VAULT_ADDRESS,
      value: 0n,
      data: '0xac9650d80000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000064b460af9400000000000000000000000000000000000000000000000006f05b59d3b200000000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f490000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f4900000000000000000000000000000000000000000000000000000000'
    }
    const expectedVisualization = [
      getAction('Withdraw from vault'),
      getToken(VAULT_ADDRESS, 500000000000000000n)
    ]
    const irCalls = [call].map((c) => MetaMorphoModule(accountOp, c))
    compareHumanizerVisualizations(irCalls, [expectedVisualization])
  })

  test('leaves a multicall(bytes[]) with zero recognized inner calls untouched (e.g. Uniswap router)', () => {
    const call: IrCall = {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value: 0n,
      // unrelated selector inside the bundle, not a known vault action
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000849b2c0a3700000000000000000000000000000000000000000000000000000000000000000000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f4900000000000000000000000000000000000000000000000000000000000000000000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f4900000000000000000000000000000000000000000000000000000000'
    }
    const irCall = MetaMorphoModule(accountOp, call)
    expect(irCall.fullVisualization).toBeUndefined()
  })

  test('mixes a known and an unrecognized inner call, separated by a break line', () => {
    const call: IrCall = {
      to: VAULT_ADDRESS,
      value: 0n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000849b2c0a3700000000000000000000000000000000000000000000000000000000000000000000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f4900000000000000000000000000000000000000000000000000000000000000000000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f49'
    }
    const expectedVisualization = [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(VAULT_ADDRESS, 1000000000000000000n),
      getLabel('to'),
      getAddressVisualization(SPENDER),
      getBreak(),
      getAction('Unknown call')
    ]
    const irCalls = [call].map((c) => MetaMorphoModule(accountOp, c))
    compareHumanizerVisualizations(irCalls, [expectedVisualization])
  })

  describe('unlimited approval warnings', () => {
    const multicallAbi = parseAbi(['function multicall(bytes[] data)'])
    const approveAbi = parseAbi(['function approve(address spender, uint256 amount)'])
    const depositAbi = parseAbi(['function deposit(uint256 assets, address receiver)'])

    const vaultMulticall = (innerCalls: `0x${string}`[]): IrCall => ({
      to: VAULT_ADDRESS,
      value: 0n,
      data: encodeFunctionData({ abi: multicallAbi, args: [innerCalls] })
    })
    const approveInnerCall = (amount: bigint) =>
      encodeFunctionData({ abi: approveAbi, args: [SPENDER, amount] })
    const depositInnerCall = encodeFunctionData({
      abi: depositAbi,
      args: [10n ** 18n, accountOp.accountAddr as `0x${string}`]
    })

    test('warns when an inner approve is for the maximum amount', () => {
      const irCall = MetaMorphoModule(accountOp, vaultMulticall([approveInnerCall(maxUint256)]))

      expect(irCall.warnings).toEqual([getUnlimitedApprovalWarning(SPENDER)])
    })

    // the approval is easy to miss when it is one of several actions in the batch
    test('warns when a maximum inner approve is batched with other actions', () => {
      const irCall = MetaMorphoModule(
        accountOp,
        vaultMulticall([approveInnerCall(maxUint256), depositInnerCall])
      )

      expect(irCall.warnings).toEqual([getUnlimitedApprovalWarning(SPENDER)])
      expect(irCall.fullVisualization).toBeDefined()
    })

    test('does not warn when an inner approve is for a finite amount', () => {
      const irCall = MetaMorphoModule(accountOp, vaultMulticall([approveInnerCall(10n ** 18n)]))

      expect(irCall.warnings).toBeUndefined()
    })

    test('does not warn when an inner approve revokes', () => {
      const irCall = MetaMorphoModule(accountOp, vaultMulticall([approveInnerCall(0n)]))

      expect(irCall.warnings).toBeUndefined()
    })
  })
})
