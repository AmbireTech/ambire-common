import { getAddress, Interface, toBeHex, ZeroHash } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { RPCProvider } from '../../interfaces/provider'
import { ZERO_ADDRESS } from '../../services/socket/constants'
import {
  PrivacyPoolsSerializedUserOperation,
  estimatePaymasterWithdrawalFee
} from './estimateWithdrawal'

// Taken from a real ETH withdrawal on Ethereum (tx 0x7bda295d…e518)
const SENDER = getAddress('0xA3a4D83896ec4b595668fA3d5430157cd235F720')
const RECIPIENT = getAddress('0x8300Fa08E29e3fCaC7013fc760EeEf3026D4e23e')
const ADAPTER = getAddress('0x0a230D83f16209E2692494a0ae139aAD8C96bde9')
const PAYMASTER = getAddress('0xe06CB96C57D2442f8F60F5017354BC08F7e91308')
const ENTRY_POINT = getAddress('0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108')
const SIMPLE_7702 = getAddress('0xe6Cae83BdE06E4c305530e199D7217f42808555B')
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
const ATTACKER = getAddress('0x0000000000000000000000000000000000000bad')
const NATIVE_TRANSFERS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const FEE = 2043973863120000n
const REFUND = 1234094322120042n
const BASE_FEE = 335893529n

const USER_OPERATION: PrivacyPoolsSerializedUserOperation = {
  sender: SENDER,
  nonce: '0x0',
  callData: '0x',
  callGasLimit: '0x0',
  verificationGasLimit: toBeHex(50_000n),
  preVerificationGas: toBeHex(100_000n),
  maxFeePerGas: toBeHex(1216651109n),
  maxPriorityFeePerGas: toBeHex(688303294n),
  paymaster: PAYMASTER,
  paymasterVerificationGasLimit: toBeHex(1_200_000n),
  paymasterPostOpGasLimit: toBeHex(50_000n),
  paymasterData: '0xabcdef',
  signature: `0x${'11'.repeat(65)}`,
  eip7702Auth: { address: SIMPLE_7702 }
}

const entryPointInterface = new Interface([
  'function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
])
const transferInterface = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
])

const transferLog = (token: string, from: string, to: string, value: bigint) => ({
  address: token,
  ...transferInterface.encodeEventLog('Transfer', [from, to, value])
})

const userOperationLog = (success = true) => ({
  address: ENTRY_POINT,
  ...entryPointInterface.encodeEventLog('UserOperationEvent', [
    ZeroHash,
    SENDER,
    PAYMASTER,
    0n,
    success,
    823625286561441n,
    804167n
  ])
})

/** The transfers a successful withdrawal makes, in the order the pool, adapter and paymaster make them. */
const withdrawalLogs = (token: string, amount: bigint, refund = REFUND, fee = FEE) => [
  transferLog(token, '0xF241d57C6DebAe225c0F2e6eA1529373C9A9C9fB', ADAPTER, amount),
  transferLog(token, ADAPTER, PAYMASTER, fee),
  transferLog(token, ADAPTER, RECIPIENT, amount - fee),
  ...(refund ? [transferLog(token, PAYMASTER, RECIPIENT, refund)] : []),
  userOperationLog()
]

const mockProvider = (call: object) => {
  const send = jest.fn<(method: string, params: any[]) => Promise<unknown>>(async () => [
    { calls: [call] }
  ])
  const provider = {
    getBlock: jest.fn(async () => ({ baseFeePerGas: BASE_FEE })),
    send
  } as unknown as RPCProvider

  return { provider, send }
}

const estimate = (provider: RPCProvider, overrides: Record<string, unknown> = {}) =>
  estimatePaymasterWithdrawalFee({
    provider,
    userOperation: USER_OPERATION,
    entryPointAddress: ENTRY_POINT,
    paymasterAddress: PAYMASTER,
    recipient: RECIPIENT,
    tokenAddress: ZERO_ADDRESS,
    fee: FEE,
    ...overrides
  })

describe('estimatePaymasterWithdrawalFee', () => {
  test('expects the fee minus what the paymaster refunds to the recipient', async () => {
    const { provider } = mockProvider({
      status: '0x1',
      logs: withdrawalLogs(NATIVE_TRANSFERS, 5n * 10n ** 15n)
    })

    await expect(estimate(provider)).resolves.toMatchObject({ expectedFee: FEE - REFUND })
  })

  test('runs the signed userOp through handleOps with the sender delegated and the latest base fee', async () => {
    const { provider, send } = mockProvider({
      status: '0x1',
      logs: withdrawalLogs(NATIVE_TRANSFERS, 5n * 10n ** 15n)
    })

    await estimate(provider)

    const [method, [params, blockTag]] = send.mock.calls[0]!
    const [block] = params.blockStateCalls
    expect(method).toBe('eth_simulateV1')
    expect(blockTag).toBe('latest')
    expect(params.traceTransfers).toBe(true)
    expect(block.blockOverrides.baseFeePerGas).toBe(toBeHex(BASE_FEE))
    expect(block.stateOverrides[SENDER].code.toLowerCase()).toBe(
      `0xef0100${SIMPLE_7702.slice(2)}`.toLowerCase()
    )

    const [call] = block.calls
    expect(call.to).toBe(ENTRY_POINT)
    const [[op], beneficiary] = entryPointInterface.decodeFunctionData('handleOps', call.data)
    // Not the caller, whose overridden maximum balance the gas payment would overflow
    expect(beneficiary).not.toBe(getAddress(call.from))
    // Funded to pay for the run, and not a precompile: some nodes stop running `ecrecover` once
    // `0x...01` is overridden, which fails the sender's signature check
    expect(block.stateOverrides[call.from].balance).toBeDefined()
    expect(BigInt(call.from)).toBeGreaterThan(0x1_0000n)
    expect(op.sender).toBe(SENDER)
    expect(op.initCode).toBe('0x')
    expect(op.signature).toBe(USER_OPERATION.signature)
    // verificationGasLimit ‖ callGasLimit, then maxPriorityFeePerGas ‖ maxFeePerGas, 16 bytes each
    expect(op.accountGasLimits).toBe(`0x${50_000n.toString(16).padStart(32, '0')}${'0'.repeat(32)}`)
    expect(op.gasFees).toBe(
      `0x${688303294n.toString(16).padStart(32, '0')}${1216651109n.toString(16).padStart(32, '0')}`
    )
    expect(op.paymasterAndData).toBe(
      `${PAYMASTER.toLowerCase()}${1_200_000n.toString(16).padStart(32, '0')}${50_000n
        .toString(16)
        .padStart(32, '0')}abcdef`
    )
  })

  test('reads the refund of an ERC-20 withdrawal from the token and from the paymaster only', async () => {
    const usdcFee = 5_900_000n
    const usdcRefund = 3_600_000n
    const { provider } = mockProvider({
      status: '0x1',
      logs: [
        ...withdrawalLogs(USDC, 100n * 10n ** 6n, usdcRefund, usdcFee),
        // Another token, another sender and another receiver are not the refund
        transferLog(NATIVE_TRANSFERS, PAYMASTER, RECIPIENT, 7n),
        transferLog(USDC, ADAPTER, RECIPIENT, 9n),
        transferLog(USDC, PAYMASTER, ATTACKER, 11n)
      ]
    })

    await expect(estimate(provider, { tokenAddress: USDC, fee: usdcFee })).resolves.toMatchObject({
      expectedFee: usdcFee - usdcRefund
    })
  })

  test('expects the whole fee when nothing is refunded', async () => {
    const { provider } = mockProvider({
      status: '0x1',
      logs: withdrawalLogs(NATIVE_TRANSFERS, 5n * 10n ** 15n, 0n)
    })

    await expect(estimate(provider)).resolves.toMatchObject({ expectedFee: FEE })
  })

  test('reports the gas the userOp used and a refund stranded on the sender', async () => {
    const strandedRefund = 123n
    const { provider } = mockProvider({
      status: '0x1',
      logs: [
        ...withdrawalLogs(NATIVE_TRANSFERS, 5n * 10n ** 15n, 0n),
        transferLog(NATIVE_TRANSFERS, PAYMASTER, SENDER, strandedRefund),
        // Not from the paymaster, so not a refund
        transferLog(NATIVE_TRANSFERS, ADAPTER, SENDER, 7n)
      ]
    })

    await expect(estimate(provider)).resolves.toEqual({
      expectedFee: FEE,
      gasUsed: 804167n,
      gasCost: 823625286561441n,
      senderRefund: strandedRefund
    })
  })

  test('refuses a withdrawal that would revert', async () => {
    const { provider } = mockProvider({
      status: '0x0',
      logs: [],
      error: { message: 'execution reverted', data: '0x65c8fd4d' }
    })

    await expect(estimate(provider)).rejects.toThrow('would fail on chain')
  })

  test('refuses a user operation that fails on chain', async () => {
    const { provider } = mockProvider({ status: '0x1', logs: [userOperationLog(false)] })

    await expect(estimate(provider)).rejects.toThrow('would revert on chain')
  })

  test('refuses a refund larger than the fee', async () => {
    const { provider } = mockProvider({
      status: '0x1',
      logs: withdrawalLogs(NATIVE_TRANSFERS, 5n * 10n ** 15n, FEE + 1n)
    })

    await expect(estimate(provider)).rejects.toThrow('larger than the withdrawal fee')
  })

  test('refuses a userOp without a 7702 authorization, whose sender has no code to run', async () => {
    const { provider, send } = mockProvider({ status: '0x1', logs: [] })

    await expect(
      estimate(provider, { userOperation: { ...USER_OPERATION, eip7702Auth: undefined } })
    ).rejects.toThrow('no 7702 authorization')
    expect(send).not.toHaveBeenCalled()
  })
})
