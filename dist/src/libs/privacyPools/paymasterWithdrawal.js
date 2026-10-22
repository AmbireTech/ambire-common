"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPaymasterWithdrawal = void 0;
const ethers_1 = require("ethers");
const privacyPools_1 = require("../../consts/privacyPools");
/** `paymasterData`: the adapter the paymaster hands the withdrawal to, and its input. */
const PAYMASTER_DATA_TYPE = 'tuple(address adapter, bytes adapterData)';
/**
 * The adapter's input: the pool withdrawal and its proof. `pubSignals[2]` is the withdrawn value
 * (the circuit orders outputs before inputs).
 */
const ADAPTER_DATA_TYPE = 'tuple(tuple(address processooor, bytes data) withdrawal, tuple(uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)';
/**
 * `withdrawal.data`, as the adapter decodes it to split the funds. `refundRecipient` gets the part
 * of the fee gas does not use, in the paymaster's postOp.
 */
const FEE_DATA_TYPE = 'tuple(address recipient, address feeRecipient, uint256 fee, address refundRecipient)';
const WITHDRAWN_VALUE_SIGNAL_INDEX = 2;
/** What the single-use sender runs after being paid - see `readBatchCalls`. */
const SENDER_INTERFACE = new ethers_1.Interface([
    'function executeBatch((address target, uint256 value, bytes data)[] calls)'
]);
/** A deposit withdrawn by the sender itself, outside the paymaster - see `readBatchCalls`. */
const POOL_INTERFACE = new ethers_1.Interface([
    'function withdraw((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)'
]);
const ERC20_INTERFACE = new ethers_1.Interface(['function transfer(address to, uint256 amount)']);
const toHexAddress = (address) => (0, ethers_1.getAddress)(`0x${address.toString(16).padStart(40, '0')}`);
const isSameAddress = (a, b) => (0, ethers_1.getAddress)(a) === (0, ethers_1.getAddress)(b);
/**
 * Checks a batch withdrawal's calls and returns what the deposits beyond the sponsored one add, and
 * who the forward pays.
 *
 * The paymaster sponsors only one deposit, paid to the sender when the userOp has calls. The sender
 * must withdraw each other deposit itself, then forward the total minus the fee to the recipient -
 * in that order, and nothing else.
 */
const readBatchCalls = ({ callData, sender, poolAddress, tokenAddress, recipient, amountOut }) => {
    let calls;
    try {
        ;
        [calls] = SENDER_INTERFACE.decodeFunctionData('executeBatch', callData);
    }
    catch {
        throw new Error('privacyPools: the withdrawal runs calls of an unexpected shape');
    }
    const withdrawCalls = calls.slice(0, -1);
    const forwardCall = calls[calls.length - 1];
    if (!forwardCall || !withdrawCalls.length)
        throw new Error('privacyPools: the withdrawal runs calls of an unexpected shape');
    const withdrawnValue = withdrawCalls.reduce((sum, call) => {
        if (!isSameAddress(call.target, poolAddress) || call.value !== 0n)
            throw new Error('privacyPools: the withdrawal calls an unexpected contract');
        let processooor;
        let pubSignals;
        try {
            ;
            [{ processooor }, { pubSignals }] = POOL_INTERFACE.decodeFunctionData('withdraw', call.data);
        }
        catch {
            throw new Error('privacyPools: the withdrawal calls the pool in an unexpected way');
        }
        // The pool pays whoever submits the withdrawal, so anything else would bypass the forward
        if (!isSameAddress(processooor, sender))
            throw new Error('privacyPools: a deposit in the withdrawal pays out to an unexpected address');
        return sum + BigInt(pubSignals[WITHDRAWN_VALUE_SIGNAL_INDEX]);
    }, 0n);
    const isNative = (0, privacyPools_1.isPrivacyPoolsNativeAsset)(tokenAddress);
    const expectedForwardCall = isNative
        ? { target: recipient, value: amountOut, data: '0x' }
        : {
            target: tokenAddress,
            value: 0n,
            data: ERC20_INTERFACE.encodeFunctionData('transfer', [recipient, amountOut])
        };
    if (!isSameAddress(forwardCall.target, expectedForwardCall.target) ||
        forwardCall.value !== expectedForwardCall.value ||
        forwardCall.data.toLowerCase() !== expectedForwardCall.data.toLowerCase())
        throw new Error('privacyPools: the withdrawal forwards the funds differently than requested');
    const [forwardRecipient] = isNative
        ? [forwardCall.target]
        : ERC20_INTERFACE.decodeFunctionData('transfer', forwardCall.data);
    return {
        withdrawnValue,
        noteCount: withdrawCalls.length + 1,
        recipient: (0, ethers_1.getAddress)(forwardRecipient)
    };
};
/**
 * Decodes a prepared paymaster withdrawal and checks it against the request, returning what it
 * does - to show it from the payload rather than from the request.
 *
 * Security boundary: the SDK builds and signs the userOp in one call, so this is the one
 * place to verify, from the bytes the paymaster and pool act on, the token, the recipient, the
 * amount, the fee recipient and the refund recipient. Any mismatch is refused before the user is
 * asked to send it.
 *
 * A single deposit is paid straight to the recipient with no calls; a batch goes through the
 * single-use sender - see `readBatchCalls`.
 */
const readPaymasterWithdrawal = ({ withdrawal, paymaster, poolAddress: tokenPoolAddress, recipient, tokenAddress, amount }) => {
    const { userOperation } = withdrawal;
    const poolAddress = toHexAddress(withdrawal.poolAddress).toLowerCase();
    const expectedAdapter = paymaster.poolAdapters[poolAddress];
    if (!expectedAdapter)
        throw new Error(`privacyPools: no paymaster adapter configured for pool ${poolAddress}`);
    // Otherwise another token's pool would pass, its amount compared as if it were this token's
    if (!isSameAddress(poolAddress, tokenPoolAddress))
        throw new Error('privacyPools: the withdrawal is from the pool of a different token');
    if (!isSameAddress(withdrawal.entryPointAddress, paymaster.entryPointAddress))
        throw new Error('privacyPools: the withdrawal targets an unexpected ERC-4337 entry point');
    if (!userOperation.paymaster ||
        !isSameAddress(userOperation.paymaster, paymaster.paymasterAddress) ||
        !isSameAddress(withdrawal.paymasterAddress, paymaster.paymasterAddress))
        throw new Error('privacyPools: the withdrawal is sponsored by an unexpected paymaster');
    if (!userOperation.paymasterData)
        throw new Error('privacyPools: the withdrawal carries no paymaster data');
    const coder = ethers_1.AbiCoder.defaultAbiCoder();
    const [{ adapter, adapterData }] = coder.decode([PAYMASTER_DATA_TYPE], userOperation.paymasterData);
    const [{ withdrawal: { processooor, data }, proof: { pubSignals } }] = coder.decode([ADAPTER_DATA_TYPE], adapterData);
    const [feeData] = coder.decode([FEE_DATA_TYPE], data);
    if (!isSameAddress(adapter, expectedAdapter) || !isSameAddress(processooor, expectedAdapter))
        throw new Error('privacyPools: the withdrawal is routed through an unexpected adapter');
    if (!isSameAddress(feeData.feeRecipient, paymaster.paymasterAddress))
        throw new Error('privacyPools: the withdrawal fee goes to an unexpected address');
    // Also for a batch, whose payout goes to the single-use sender, out of the wallet's reach
    if (!isSameAddress(feeData.refundRecipient, recipient))
        throw new Error('privacyPools: the withdrawal refunds unused gas to an unexpected address');
    const fee = BigInt(feeData.fee);
    const sponsoredValue = BigInt(pubSignals[WITHDRAWN_VALUE_SIGNAL_INDEX]);
    const isPaidToRecipient = isSameAddress(feeData.recipient, recipient);
    if (!isPaidToRecipient && !isSameAddress(feeData.recipient, userOperation.sender))
        throw new Error('privacyPools: the withdrawal pays out to a different address than requested');
    if (isPaidToRecipient && userOperation.callData !== '0x')
        throw new Error('privacyPools: the withdrawal runs calls it should not');
    if (fee >= amount)
        throw new Error('privacyPools: the withdrawal fee would take the whole amount');
    const batch = isPaidToRecipient
        ? { withdrawnValue: 0n, noteCount: 1, recipient: (0, ethers_1.getAddress)(feeData.recipient) }
        : readBatchCalls({
            callData: userOperation.callData,
            sender: userOperation.sender,
            poolAddress,
            tokenAddress,
            recipient,
            amountOut: amount - fee
        });
    const withdrawnAmount = sponsoredValue + batch.withdrawnValue;
    if (withdrawnAmount !== amount)
        throw new Error('privacyPools: the withdrawal proves a different amount than requested');
    return {
        recipient: batch.recipient,
        // The pool's token: the pool is checked above to be the one the entrypoint lists for it
        tokenAddress,
        amount: withdrawnAmount,
        fee,
        noteCount: batch.noteCount
    };
};
exports.readPaymasterWithdrawal = readPaymasterWithdrawal;
//# sourceMappingURL=paymasterWithdrawal.js.map