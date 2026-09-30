import { concat, getAddress, id, Interface, toBeHex, toQuantity, zeroPadValue } from 'ethers'

import { isPrivacyPoolsNativeAsset } from '../../consts/privacyPools'
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { RPCProvider } from '../../interfaces/provider'

/**
 * The parts of the SDK's serialized userOp a simulation reads - hex quantities, the shape
 * `eth_sendUserOperation` takes. Declared here rather than imported for the same reason as in
 * `paymasterWithdrawal`: the SDK does not export the type from its entry point.
 */
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

/**
 * What an account's code is set to under EIP-7702: this prefix followed by the address of the
 * contract whose code it runs.
 */
const EIP7702_DESIGNATOR_PREFIX = '0xef0100'

/**
 * Where `eth_simulateV1` reports native transfers when `traceTransfers` is on: as ERC-20 `Transfer`
 * logs emitted from this address.
 */
const SIMULATED_NATIVE_TRANSFER_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const MAX_BALANCE = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

/**
 * Where the simulated `handleOps` sends the gas payment a bundler would collect. Not the calling
 * address: that one is given the maximum balance, which the payment would overflow.
 */
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

/**
 * The userOp in the packed form `EntryPoint.handleOps` takes: pairs of gas values share a word,
 * and the paymaster's address, gas limits and data are one byte string.
 */
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

/**
 * Estimates what a prepared, signed paymaster withdrawal will actually cost, by running it on top of
 * the latest block without sending it.
 *
 * The fee locked into the proof is a ceiling: it covers every gas limit at the userOp's maximum
 * gas price, with a margin on top, and the paymaster refunds what it did not spend to the recipient
 * in the same transaction. What the user actually pays is that fee minus the refund, which is only
 * known by running the transaction - so it is run here, through `EntryPoint.handleOps`, exactly as
 * the bundler will submit it.
 *
 * On chain, the single-use sender becomes a smart account through the 7702 authorization the
 * bundler puts into the transaction. A simulated call carries no authorization, so the sender is
 * given the delegated code by a state override instead. Everything else - the signature, the
 * proof, the pool, the paymaster's deposit and its price oracle - is the real on-chain state, and
 * the gas price is the latest block's base fee plus the userOp's own priority fee, as it will be
 * when it lands in a block with the same base fee.
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
}): Promise<{ expectedFee: bigint }> => {
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
          // Without it, a simulation without validation runs at a base fee of zero - and the
          // paymaster would refund as if the gas cost only the priority fee
          blockOverrides: { baseFeePerGas: toQuantity(latestBlock.baseFeePerGas) },
          stateOverrides: {
            [userOperation.sender]: { code: concat([EIP7702_DESIGNATOR_PREFIX, delegate]) },
            [DEPLOYLESS_SIMULATION_FROM]: { balance: MAX_BALANCE }
          },
          calls: [
            {
              from: DEPLOYLESS_SIMULATION_FROM,
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
  if (!ENTRY_POINT_INTERFACE.parseLog(userOperationEvent)?.args.success)
    throw new Error('privacyPools: the withdrawal would revert on chain')

  const refundTokenAddress = isPrivacyPoolsNativeAsset(tokenAddress)
    ? SIMULATED_NATIVE_TRANSFER_ADDRESS
    : tokenAddress
  // The adapter pays the recipient too, so only what comes from the paymaster is the refund
  const refund = logs.reduce((sum, log) => {
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
    if (!isSameAddress(from, paymasterAddress) || !isSameAddress(to, recipient)) return sum

    return sum + BigInt(value)
  }, 0n)

  if (refund > fee)
    throw new Error('privacyPools: the simulated refund is larger than the withdrawal fee')

  return { expectedFee: fee - refund }
}
