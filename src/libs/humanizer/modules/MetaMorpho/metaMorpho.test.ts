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

  // the vault has functions this module does not decode, and a batch may hold another batch.
  // an inner selector this module does not know is shown as unknown, with no warning:
  // `multicall(bytes[])` is not unique to MetaMorpho, so the call may be an ordinary one on
  // some other contract
  describe('inner calls the module does not decode', () => {
    const multicallAbi = parseAbi(['function multicall(bytes[] data)'])
    const approveAbi = parseAbi(['function approve(address spender, uint256 amount)'])

    const vaultMulticall = (innerCalls: `0x${string}`[]): IrCall => ({
      to: VAULT_ADDRESS,
      value: 0n,
      data: encodeFunctionData({ abi: multicallAbi, args: [innerCalls] })
    })
    const approveInnerCall = encodeFunctionData({
      abi: approveAbi,
      args: [SPENDER, 1000000000000000000n]
    })
    // a real vault function this module has no matcher for
    const unhandledInnerCall = encodeFunctionData({
      abi: parseAbi(['function setFee(uint256 newFee)']),
      args: [10n ** 17n]
    })

    test('does not warn about an inner call it cannot decode', () => {
      const irCall = MetaMorphoModule(
        accountOp,
        vaultMulticall([approveInnerCall, unhandledInnerCall])
      )

      expect(irCall.warnings).toBeUndefined()
    })

    // a batch inside the batch is a valid inner call too - see the "nested batches" describe
    // block below for the full coverage of that recursion
    test('reads a batch nested inside the batch instead of showing it as unknown', () => {
      const nestedBundle = encodeFunctionData({ abi: multicallAbi, args: [[approveInnerCall]] })
      const irCalls = [vaultMulticall([approveInnerCall, nestedBundle])].map((c) =>
        MetaMorphoModule(accountOp, c)
      )

      compareHumanizerVisualizations(irCalls, [
        [
          getAction('Grant approval'),
          getLabel('for'),
          getToken(VAULT_ADDRESS, 1000000000000000000n),
          getLabel('to'),
          getAddressVisualization(SPENDER),
          getBreak(),
          getAction('Grant approval'),
          getLabel('for'),
          getToken(VAULT_ADDRESS, 1000000000000000000n),
          getLabel('to'),
          getAddressVisualization(SPENDER)
        ]
      ])
      expect(irCalls[0].warnings).toBeUndefined()
    })

    // an approval with no limit still has to reach the user, even next to a call it cannot read
    test('still reports an unlimited approval batched with an unknown call', () => {
      const unlimitedApprove = encodeFunctionData({ abi: approveAbi, args: [SPENDER, maxUint256] })
      const irCall = MetaMorphoModule(
        accountOp,
        vaultMulticall([unlimitedApprove, unhandledInnerCall])
      )

      expect(irCall.warnings).toEqual([getUnlimitedApprovalWarning(SPENDER)])
    })

    // nothing was recognized, so this may belong to another protocol
    test('leaves a batch with no readable call to the other humanizer modules', () => {
      const irCall = MetaMorphoModule(accountOp, vaultMulticall([unhandledInnerCall]))

      expect(irCall.fullVisualization).toBeUndefined()
      expect(irCall.warnings).toBeUndefined()
    })
  })

  // pre solidity 0.5.0 tokens accept calldata shorter than the abi args and treat the missing
  // bytes as zeroes. The vault's inner calls are padded the same way the token module pads them
  describe('inner calls with short calldata', () => {
    const paddedSpender = `000000000000000000000000${SPENDER.substring(2).toLowerCase()}`
    const vaultMulticall = (innerCall: string): IrCall => ({
      to: VAULT_ADDRESS,
      value: 0n,
      data: encodeFunctionData({
        abi: parseAbi(['function multicall(bytes[] data)']),
        args: [[`0x${innerCall}` as `0x${string}`]]
      })
    })

    test('reads an inner approve with no amount word as a revoke', () => {
      const irCalls = [vaultMulticall(`095ea7b3${paddedSpender}`)].map((c) =>
        MetaMorphoModule(accountOp, c)
      )

      compareHumanizerVisualizations(irCalls, [
        [
          getAction('Revoke approval'),
          getToken(VAULT_ADDRESS, 0n),
          getLabel('for'),
          getAddressVisualization(SPENDER)
        ]
      ])
    })

    test('reads an inner transfer with no amount word', () => {
      const irCalls = [vaultMulticall(`a9059cbb${paddedSpender}`)].map((c) =>
        MetaMorphoModule(accountOp, c)
      )

      compareHumanizerVisualizations(irCalls, [
        [
          getAction('Send'),
          getToken(VAULT_ADDRESS, 0n),
          getLabel('to'),
          getAddressVisualization(SPENDER)
        ]
      ])
    })
  })

  // a batch may hold another batch - every level still runs against the same vault, and there
  // is no depth limit: nested calldata is always part of its parent calldata, so it is always
  // shorter and the recursion always terminates on its own
  describe('nested batches', () => {
    const multicallAbi = parseAbi(['function multicall(bytes[] data)'])
    const approveAbi = parseAbi(['function approve(address spender, uint256 amount)'])

    const wrapInMulticall = (innerCalls: `0x${string}`[]) =>
      encodeFunctionData({ abi: multicallAbi, args: [innerCalls] })
    const nest = (layers: number, innerCall: `0x${string}`): `0x${string}` =>
      layers === 0 ? innerCall : nest(layers - 1, wrapInMulticall([innerCall]))
    const approveInnerCall = encodeFunctionData({
      abi: approveAbi,
      args: [SPENDER, 1000000000000000000n]
    })
    const expectedApprovalVisualization = [
      getAction('Grant approval'),
      getLabel('for'),
      getToken(VAULT_ADDRESS, 1000000000000000000n),
      getLabel('to'),
      getAddressVisualization(SPENDER)
    ]

    test('decodes an approve wrapped in a batch inside a batch', () => {
      const call: IrCall = { to: VAULT_ADDRESS, value: 0n, data: nest(2, approveInnerCall) }
      const irCalls = [call].map((c) => MetaMorphoModule(accountOp, c))

      compareHumanizerVisualizations(irCalls, [expectedApprovalVisualization])
    })

    test('carries an unlimited approval warning up from a nested batch', () => {
      const unlimitedApprove = encodeFunctionData({ abi: approveAbi, args: [SPENDER, maxUint256] })
      const call: IrCall = { to: VAULT_ADDRESS, value: 0n, data: nest(3, unlimitedApprove) }

      expect(MetaMorphoModule(accountOp, call).warnings).toEqual([
        getUnlimitedApprovalWarning(SPENDER)
      ])
    })

    // there is no cap on how deep this goes - each level's calldata is strictly shorter than
    // its parent's, so a very deep batch is unusual but still safe to walk all the way down
    test('decodes a batch nested many levels deep', () => {
      const call: IrCall = { to: VAULT_ADDRESS, value: 0n, data: nest(10, approveInnerCall) }
      const irCalls = [call].map((c) => MetaMorphoModule(accountOp, c))

      compareHumanizerVisualizations(irCalls, [expectedApprovalVisualization])
    })

    test('leaves an empty nested batch unhumanized', () => {
      const call: IrCall = { to: VAULT_ADDRESS, value: 0n, data: nest(2, wrapInMulticall([])) }

      expect(MetaMorphoModule(accountOp, call).fullVisualization).toBeUndefined()
    })
  })

  // the exact bytes a dapp sent: a batch holding a batch, with the outer bytes element not
  // padded to a full 32 byte word
  test('decodes a nested batch whose outer bytes element is not padded', () => {
    const call: IrCall = {
      to: VAULT_ADDRESS,
      value: 0n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e4ac9650d80000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000000000000000000000000000000000000000beefffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000'
    }
    const spender = '0x000000000000000000000000000000000000bEEF'
    const irCall = MetaMorphoModule(accountOp, call)

    compareHumanizerVisualizations(
      [irCall],
      [
        [
          getAction('Grant approval'),
          getLabel('for'),
          getToken(VAULT_ADDRESS, maxUint256),
          getLabel('to'),
          getAddressVisualization(spender)
        ]
      ]
    )
    expect(irCall.warnings).toEqual([getUnlimitedApprovalWarning(spender)])
  })
})
