import { concat, getAddress, id, Interface, toBeHex, toQuantity, zeroPadValue } from 'ethers'

import { isPrivacyPoolsNativeAsset } from '../../consts/privacyPools'
import { RPCProvider } from '../../interfaces/provider'

/** The parts of the SDK's serialized userOp a simulation reads. Not exported by the SDK. */
export type PrivacyPoolsSerializedUserOperation = {
  sender: string
  nonce: string
  callData: string
  callGasLimit: string
  verificationGasLimit: string
  preVerificationGas: string
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  paymaster?: string
  paymasterVerificationGasLimit?: string
  paymasterPostOpGasLimit?: string
  paymasterData?: string
  signature: string
  /** Signed by the single-use sender; `address` is the contract whose code it takes on. */
  eip7702Auth?: { address: string }
}

/** EIP-7702 delegated code: this prefix followed by the delegate's address. */
const EIP7702_DESIGNATOR_PREFIX = '0xef0100'

/** `eth_simulateV1` with `traceTransfers` reports native transfers as `Transfer` logs from here. */
const SIMULATED_NATIVE_TRANSFER_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const MAX_BALANCE = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

/**
 * Caller of the simulated `handleOps`, given the maximum balance. Not `DEPLOYLESS_SIMULATION_FROM`
 * (`0x...01`, the `ecrecover` precompile): some nodes stop running the precompile once its account
 * is overridden, which failed about one run in three with `AA23` on Ethereum.
 */
const SIMULATION_CALLER = '0x00000000000000000000000000000000C0FFEE01'

/** Receives the simulated gas payment. Not the caller, whose maximum balance it would overflow. */
const SIMULATION_BENEFICIARY = '0x000000000000000000000000000000000000dEaD'

const ENTRY_POINT_INTERFACE = new Interface([
  'function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
])

const TRANSFER_INTERFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)'
])

const USER_OPERATION_EVENT_TOPIC = id(
  'UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)'
)
const TRANSFER_TOPIC = id('Transfer(address,address,uint256)')

type SimulatedLog = { address: string; topics: string[]; data: string }

type SimulatedCall = {
  status: string
  logs?: SimulatedLog[]
  error?: { message?: string; data?: string }
}

const toUint128 = (value: string | undefined) => zeroPadValue(toBeHex(BigInt(value ?? 0)), 16)

const isSameAddress = (a: string, b: string) => getAddress(a) === getAddress(b)

/** Packs the userOp into the form `EntryPoint.handleOps` takes. */
const packUserOperation = (userOperation: PrivacyPoolsSerializedUserOperation) => {
  if (!userOperation.paymaster)
    throw new Error('privacyPools: the withdrawal to simulate carries no paymaster')

  return {
    sender: userOperation.sender,
    nonce: BigInt(userOperation.nonce),
    // The sender takes on its code through the 7702 authorization, not through a factory
    initCode: '0x',
    callData: userOperation.callData,
    accountGasLimits: concat([
      toUint128(userOperation.verificationGasLimit),
      toUint128(userOperation.callGasLimit)
    ]),
    preVerificationGas: BigInt(userOperation.preVerificationGas),
    gasFees: concat([
      toUint128(userOperation.maxPriorityFeePerGas),
      toUint128(userOperation.maxFeePerGas)
    ]),
    paymasterAndData: concat([
      userOperation.paymaster,
      toUint128(userOperation.paymasterVerificationGasLimit),
      toUint128(userOperation.paymasterPostOpGasLimit),
      userOperation.paymasterData ?? '0x'
    ]),
    signature: userOperation.signature
  }
}

/** What running a prepared withdrawal showed it will cost. */
export type PrivacyPoolsWithdrawalFeeEstimate = {
  /** The fee locked into the proof minus what the paymaster refunds to the recipient. */
  expectedFee: bigint
  /** The gas the userOp used, as the entry point reports it. */
  gasUsed: bigint
  /** What that gas cost the paymaster, in wei. */
  gasCost: bigint
  /** A batch's refund, paid to the single-use sender, where nobody can reach it. */
  senderRefund: bigint
}

/**
 * Estimates what a signed paymaster withdrawal will cost by simulating `EntryPoint.handleOps` on
 * the latest block, as the bundler will submit it.
 *
 * The proof's fee is a cap (all gas limits at the max gas price, plus a margin); the paymaster
 * refunds the unspent part to the recipient. A batch's refund goes to the single-use sender after
 * it has forwarded the funds, so its expected fee is the whole fee.
 *
 * A simulated call carries no 7702 authorization, so the sender's delegated code is set by a state
 * override; everything else is real on-chain state.
 *
 * Throws when the node cannot simulate it or the withdrawal would fail.
 */
export const estimatePaymasterWithdrawalFee = async ({
  provider,
  userOperation,
  entryPointAddress,
  paymasterAddress,
  recipient,
  tokenAddress,
  fee
}: {
  provider: RPCProvider
  userOperation: PrivacyPoolsSerializedUserOperation
  entryPointAddress: string
  paymasterAddress: string
  recipient: string
  /** The withdrawn token, in the wallet's own convention - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  /** The fee locked into the proof, as `readPaymasterWithdrawal` decoded it. */
  fee: bigint
}): Promise<PrivacyPoolsWithdrawalFeeEstimate> => {
  const delegate = userOperation.eip7702Auth?.address
  if (!delegate)
    throw new Error('privacyPools: the withdrawal to simulate carries no 7702 authorization')

  const latestBlock = await provider.getBlock('latest')
  if (latestBlock?.baseFeePerGas == null)
    throw new Error('privacyPools: the latest block reports no base fee')

  const response = await provider.send('eth_simulateV1', [
    {
      blockStateCalls: [
        {
          // Without validation the base fee is otherwise zero, inflating the paymaster's refund
          blockOverrides: { baseFeePerGas: toQuantity(latestBlock.baseFeePerGas) },
          stateOverrides: {
            [userOperation.sender]: { code: concat([EIP7702_DESIGNATOR_PREFIX, delegate]) },
            [SIMULATION_CALLER]: { balance: MAX_BALANCE }
          },
          calls: [
            {
              from: SIMULATION_CALLER,
              to: entryPointAddress,
              data: ENTRY_POINT_INTERFACE.encodeFunctionData('handleOps', [
                [packUserOperation(userOperation)],
                SIMULATION_BENEFICIARY
              ])
            }
          ]
        }
      ],
      validation: false,
      traceTransfers: true
    },
    'latest'
  ])

  const call: SimulatedCall | undefined = response?.[0]?.calls?.[0]
  if (!call) throw new Error('privacyPools: the withdrawal simulation returned no result')
  if (BigInt(call.status) !== 1n)
    throw new Error(
      `privacyPools: the withdrawal would fail on chain (${call.error?.message || 'reverted'})`,
      { cause: call.error?.data }
    )

  const logs = call.logs || []
  const userOperationEvent = logs.find(
    (log) =>
      isSameAddress(log.address, entryPointAddress) && log.topics[0] === USER_OPERATION_EVENT_TOPIC
  )
  if (!userOperationEvent)
    throw new Error('privacyPools: the withdrawal simulation emitted no user operation')
  const userOperationResult = ENTRY_POINT_INTERFACE.parseLog(userOperationEvent)?.args
  if (!userOperationResult?.success)
    throw new Error('privacyPools: the withdrawal would revert on chain')

  const refundTokenAddress = isPrivacyPoolsNativeAsset(tokenAddress)
    ? SIMULATED_NATIVE_TRANSFER_ADDRESS
    : tokenAddress
  // The adapter pays the recipient too, so only what comes from the paymaster is the refund
  const sumRefundsTo = (refundRecipient: string) =>
    logs.reduce((sum, log) => {
      // Three topics: an ERC-20 transfer. An NFT's shares the signature but indexes a fourth
      if (
        !isSameAddress(log.address, refundTokenAddress) ||
        log.topics[0] !== TRANSFER_TOPIC ||
        log.topics.length !== 3
      )
        return sum

      const transfer = TRANSFER_INTERFACE.parseLog(log)
      if (!transfer) return sum

      const { from, to, value } = transfer.args
      if (!isSameAddress(from, paymasterAddress) || !isSameAddress(to, refundRecipient)) return sum

      return sum + BigInt(value)
    }, 0n)
  const refund = sumRefundsTo(recipient)

  if (refund > fee)
    throw new Error('privacyPools: the simulated refund is larger than the withdrawal fee')

  return {
    expectedFee: fee - refund,
    gasUsed: BigInt(userOperationResult.actualGasUsed),
    gasCost: BigInt(userOperationResult.actualGasCost),
    senderRefund: sumRefundsTo(userOperation.sender)
  }
}
