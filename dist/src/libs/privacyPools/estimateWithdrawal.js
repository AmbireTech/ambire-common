"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimatePaymasterWithdrawalFee = exports.PrivacyPoolsWithdrawalWouldFailError = void 0;
const ethers_1 = require("ethers");
const privacyPools_1 = require("../../consts/privacyPools");
const userOperation_1 = require("../userOperation/userOperation");
/** EIP-7702 delegated code: this prefix followed by the delegate's address. */
const EIP7702_DESIGNATOR_PREFIX = '0xef0100';
/** `eth_simulateV1` with `traceTransfers` reports native transfers as `Transfer` logs from here. */
const SIMULATED_NATIVE_TRANSFER_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const MAX_BALANCE = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
/**
 * Caller of the simulated `handleOps`, given the maximum balance. Not `DEPLOYLESS_SIMULATION_FROM`
 * (`0x...01`, the `ecrecover` precompile): some nodes stop running the precompile once its account
 * is overridden, which failed about one run in three with `AA23` on Ethereum.
 */
const SIMULATION_CALLER = '0x00000000000000000000000000000000C0FFEE01';
/** Receives the simulated gas payment. Not the caller, whose maximum balance it would overflow. */
const SIMULATION_BENEFICIARY = '0x000000000000000000000000000000000000dEaD';
const ENTRY_POINT_INTERFACE = new ethers_1.Interface([
    'function handleOps((address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature)[] ops, address beneficiary)',
    'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
]);
const TRANSFER_INTERFACE = new ethers_1.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)'
]);
const USER_OPERATION_EVENT_TOPIC = (0, ethers_1.id)('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)');
const TRANSFER_TOPIC = (0, ethers_1.id)('Transfer(address,address,uint256)');
const isSameAddress = (a, b) => (0, ethers_1.getAddress)(a) === (0, ethers_1.getAddress)(b);
/**
 * Thrown when the simulation ran and the withdrawal failed in it - unlike a node that could not
 * run it. A proof can go stale, e.g. once the association set's root moves on.
 */
class PrivacyPoolsWithdrawalWouldFailError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'PrivacyPoolsWithdrawalWouldFailError';
    }
}
exports.PrivacyPoolsWithdrawalWouldFailError = PrivacyPoolsWithdrawalWouldFailError;
/**
 * Estimates what a signed paymaster withdrawal will cost by simulating `EntryPoint.handleOps` on
 * the latest block, as the bundler will submit it.
 *
 * The proof's fee is a cap (all gas limits at the max gas price, plus a margin); the paymaster
 * refunds the unspent part to the recipient - a batch's too, as `readPaymasterWithdrawal` checks.
 *
 * A simulated call carries no 7702 authorization, so the sender's delegated code is set by a state
 * override; everything else is real on-chain state.
 *
 * Throws when the node cannot simulate it, or `PrivacyPoolsWithdrawalWouldFailError` when the
 * withdrawal would fail.
 */
const estimatePaymasterWithdrawalFee = async ({ provider, userOperation, entryPointAddress, paymasterAddress, recipient, tokenAddress, fee }) => {
    if (!userOperation.paymaster)
        throw new Error('privacyPools: the withdrawal to simulate carries no paymaster');
    const delegate = userOperation.eip7702Auth?.address;
    if (!delegate)
        throw new Error('privacyPools: the withdrawal to simulate carries no 7702 authorization');
    const latestBlock = await provider.getBlock('latest');
    if (latestBlock?.baseFeePerGas == null)
        throw new Error('privacyPools: the latest block reports no base fee');
    const response = await provider.send('eth_simulateV1', [
        {
            blockStateCalls: [
                {
                    // Without validation the base fee is otherwise zero, inflating the paymaster's refund
                    blockOverrides: { baseFeePerGas: (0, ethers_1.toQuantity)(latestBlock.baseFeePerGas) },
                    stateOverrides: {
                        [userOperation.sender]: { code: (0, ethers_1.concat)([EIP7702_DESIGNATOR_PREFIX, delegate]) },
                        [SIMULATION_CALLER]: { balance: MAX_BALANCE }
                    },
                    calls: [
                        {
                            from: SIMULATION_CALLER,
                            to: entryPointAddress,
                            data: ENTRY_POINT_INTERFACE.encodeFunctionData('handleOps', [
                                [{ ...(0, userOperation_1.getPackedUserOp)(userOperation), signature: userOperation.signature }],
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
    ]);
    const call = response?.[0]?.calls?.[0];
    if (!call)
        throw new Error('privacyPools: the withdrawal simulation returned no result');
    if (BigInt(call.status) !== 1n)
        throw new PrivacyPoolsWithdrawalWouldFailError(`privacyPools: the withdrawal would fail on chain (${call.error?.message || 'reverted'})`, { cause: call.error?.data });
    const logs = call.logs || [];
    const userOperationEvent = logs.find((log) => isSameAddress(log.address, entryPointAddress) && log.topics[0] === USER_OPERATION_EVENT_TOPIC);
    if (!userOperationEvent)
        throw new Error('privacyPools: the withdrawal simulation emitted no user operation');
    const userOperationResult = ENTRY_POINT_INTERFACE.parseLog(userOperationEvent)?.args;
    if (!userOperationResult?.success)
        throw new PrivacyPoolsWithdrawalWouldFailError('privacyPools: the withdrawal would revert on chain');
    const refundTokenAddress = (0, privacyPools_1.isPrivacyPoolsNativeAsset)(tokenAddress)
        ? SIMULATED_NATIVE_TRANSFER_ADDRESS
        : tokenAddress;
    // The adapter pays the recipient too, so only what comes from the paymaster is the refund
    const refund = logs.reduce((sum, log) => {
        // Three topics: an ERC-20 transfer. An NFT's shares the signature but indexes a fourth
        if (!isSameAddress(log.address, refundTokenAddress) ||
            log.topics[0] !== TRANSFER_TOPIC ||
            log.topics.length !== 3)
            return sum;
        const transfer = TRANSFER_INTERFACE.parseLog(log);
        if (!transfer)
            return sum;
        const { from, to, value } = transfer.args;
        if (!isSameAddress(from, paymasterAddress) || !isSameAddress(to, recipient))
            return sum;
        return sum + BigInt(value);
    }, 0n);
    if (refund > fee)
        throw new Error('privacyPools: the simulated refund is larger than the withdrawal fee');
    return {
        expectedFee: fee - refund,
        gasUsed: BigInt(userOperationResult.actualGasUsed),
        gasCost: BigInt(userOperationResult.actualGasCost)
    };
};
exports.estimatePaymasterWithdrawalFee = estimatePaymasterWithdrawalFee;
//# sourceMappingURL=estimateWithdrawal.js.map