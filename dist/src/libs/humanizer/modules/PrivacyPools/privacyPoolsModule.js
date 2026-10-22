"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanizePrivacyPoolsWithdrawal = exports.privacyPoolsModule = void 0;
const privacyPools_1 = require("../../../../consts/privacyPools");
const deposit_1 = require("../../../privacyPools/deposit");
const utils_1 = require("../../utils");
/**
 * Shows a Privacy Pools deposit as a send to a Privacy Pools account. The call ties it to the
 * account only by a precommitment, so no account is named.
 */
const privacyPoolsModule = (accountOp, call) => {
    const config = accountOp.chainId ? (0, privacyPools_1.getPrivacyPoolsChainConfig)(accountOp.chainId) : undefined;
    if (!config || call.to?.toLowerCase() !== config.entrypointAddress.toLowerCase())
        return call;
    const deposit = (0, deposit_1.readPrivacyPoolsDeposit)({ data: call.data, value: call.value });
    if (!deposit)
        return call;
    return {
        ...call,
        fullVisualization: [
            (0, utils_1.getAction)('Send'),
            (0, utils_1.getToken)((0, privacyPools_1.fromPrivacyPoolsAssetAddress)(deposit.assetAddress), deposit.amount),
            (0, utils_1.getLabel)('to a Privacy Pools account')
        ]
    };
};
exports.privacyPoolsModule = privacyPoolsModule;
/**
 * Shows a withdrawal from a Privacy Pools account as a clear-signing card, with the rows and labels
 * of a swap's. Not a call module: the withdrawal is not a call of the user's account but an
 * ERC-4337 userOp of a single-use sender, so it is described from what `readPaymasterWithdrawal`
 * read out of it, as no ERC-7730 descriptor could.
 *
 * The amount is what leaves the account; the fee comes out of it. The fee locked into the proof is
 * only a cap: the unused part is refunded to the recipient. So when the withdrawal could be
 * simulated, what the recipient gets and the fee are the expected ones; otherwise they are the
 * least the recipient gets and the most the fee can be, and say so.
 *
 * The token is one of the pools' configured assets, so its symbol and decimals go with it and the
 * card shows right away. The fee also carries the token's price, to show what it costs in USD.
 */
const humanizePrivacyPoolsWithdrawal = ({ chainId, withdrawal: { recipient, tokenAddress, amount, fee }, expectedFeeAmount, usdPrice }) => {
    const isSimulated = expectedFeeAmount !== null;
    const shownFee = expectedFeeAmount ?? fee;
    const asset = (0, privacyPools_1.getPrivacyPoolsAsset)(BigInt(chainId), tokenAddress);
    const getAssetToken = (value) => ({
        ...(0, utils_1.getToken)(tokenAddress, value),
        ...(asset && { tokenInfo: { symbol: asset.symbol, decimals: asset.decimals } })
    });
    const rows = [
        { type: 'single-value', label: 'Amount to Send', value: getAssetToken(amount) },
        {
            type: 'single-value',
            label: 'Recipient Receives',
            value: getAssetToken(amount - shownFee),
            valuePrefix: isSimulated ? '≈' : 'at least'
        },
        {
            type: 'single-value',
            label: 'Recipient',
            // A name lookup would send the recipient to our services, where it could be linked to the
            // account that deposited
            value: { ...(0, utils_1.getAddressVisualization)(recipient), isLocalLabelOnly: true },
            hasSeparatorBefore: true
        },
        {
            type: 'single-value',
            label: 'Network fee',
            value: { ...getAssetToken(shownFee), ...(usdPrice !== null && { usdPrice }) },
            ...(isSimulated ? {} : { valuePrefix: 'up to' }),
            hasSeparatorBefore: true
        }
    ];
    return {
        // No raw call: nothing in the userOp is a call the user's account makes
        value: 0n,
        data: '0x',
        fullVisualization: [(0, utils_1.getErc7730Visualization)('Send', rows)]
    };
};
exports.humanizePrivacyPoolsWithdrawal = humanizePrivacyPoolsWithdrawal;
//# sourceMappingURL=privacyPoolsModule.js.map