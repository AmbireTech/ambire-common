"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permit2Module = void 0;
const viem_1 = require("viem");
const addresses_1 = require("../../../consts/addresses");
const utils_1 = require("../utils");
function isCompletePermission(permission) {
    return permission.token !== undefined && permission.amount !== undefined;
}
// The witness struct is defined by the app that asks for the signature, so the
// address that receives the tokens can be under any of these common names
const WITNESS_RECIPIENT_FIELD_NAMES = ['recipient', 'receiver', 'to'];
function getWitnessRecipient(witness) {
    if (!witness)
        return undefined;
    const recipientFieldName = WITNESS_RECIPIENT_FIELD_NAMES.find((fieldName) => {
        const value = witness[fieldName];
        return typeof value === 'string' && (0, viem_1.isAddress)(value);
    });
    return recipientFieldName ? witness[recipientFieldName] : undefined;
}
const permit2Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    if (!tm?.domain?.verifyingContract ||
        ![addresses_1.PERMIT_2_ADDRESS.toLowerCase(), addresses_1.PANCAKE_SWAP_PERMIT_2_ADDRESS.toLocaleLowerCase()].includes(tm.domain.verifyingContract.toLowerCase()))
        return { fullVisualization: [] };
    const witnessMessageType = tm.types?.PermitWitnessTransferFrom?.[0]?.type ||
        tm.types?.PermitBatchWitnessTransferFrom?.[0]?.type;
    if (witnessMessageType &&
        ['TokenPermissions', 'TokenPermissions[]'].includes(witnessMessageType)) {
        const { permitted, spender, nonce, deadline, witness } = tm.message;
        if ([permitted, spender, nonce, deadline].some((field) => field === undefined))
            return { fullVisualization: [] };
        const permissions = Array.isArray(permitted) ? permitted : [permitted];
        const completePermissions = permissions.filter(isCompletePermission);
        if (!completePermissions.length || completePermissions.length !== permissions.length)
            return { fullVisualization: [] };
        const tokenVisualizations = completePermissions
            .map(({ token, amount }) => [(0, utils_1.getToken)(token, amount), (0, utils_1.getLabel)('and')])
            .flat()
            .slice(0, -1);
        const recipient = getWitnessRecipient(witness);
        // A zero recipient does not mean the tokens are burned. Permit2 only checks
        // the signature, so whoever executes the transfer picks where the tokens go
        const isRecipientChosenLater = !!recipient && recipient.toLowerCase() === viem_1.zeroAddress;
        const warnings = isRecipientChosenLater
            ? [
                (0, utils_1.getWarning)('This request does not say who receives the tokens. Whoever submits it decides where the tokens go. Sign it only if you fully trust the app.', 'PERMIT2_MISSING_RECIPIENT')
            ]
            : [];
        const recipientVisualizations = () => {
            if (isRecipientChosenLater)
                return [(0, utils_1.getLabel)('and send them to anyone', true)];
            if (!recipient)
                return [];
            return (0, utils_1.getRecipientText)(message.accountAddr, recipient);
        };
        return {
            fullVisualization: [
                (0, utils_1.getAction)('Approve'),
                (0, utils_1.getAddressVisualization)(spender),
                (0, utils_1.getLabel)('to transfer'),
                ...tokenVisualizations,
                ...recipientVisualizations(),
                (0, utils_1.getDeadline)(deadline)
            ],
            warnings
        };
    }
    const messageType = tm?.types?.PermitSingle?.[0]?.type ||
        tm?.types?.PermitBatch?.[0]?.type ||
        tm.types?.PermitTransferFrom?.[0]?.type;
    if (!messageType)
        return { fullVisualization: [] };
    if (messageType === 'TokenPermissions') {
        const { spender, nonce, deadline, permitted } = tm.message;
        if ([spender, nonce, deadline, permitted].some((a) => a === undefined))
            return { fullVisualization: [] };
        const { token, amount } = permitted;
        if (token === undefined || amount === undefined)
            return { fullVisualization: [] };
        return {
            fullVisualization: [
                (0, utils_1.getAction)('Approve'),
                (0, utils_1.getAddressVisualization)(spender),
                (0, utils_1.getLabel)('to use'),
                (0, utils_1.getToken)(token, amount),
                (0, utils_1.getDeadline)(deadline)
            ]
        };
    }
    else if (['PermitDetails', 'PermitDetails[]'].includes(messageType)) {
        if (!tm.message.details)
            return { fullVisualization: [] };
        const permits = (messageType === 'PermitDetails' ? [tm.message.details] : tm.message.details).map((d) => ({
            token: d.token,
            amount: d.amount
        }));
        if (permits.some((p) => p.amount === undefined || p.token === undefined))
            return { fullVisualization: [] };
        if (!permits.length)
            return { fullVisualization: [] };
        const permitVisualizations = permits
            .map(({ token, amount }) => [
            (0, utils_1.getAddressVisualization)(tm.message.spender),
            (0, utils_1.getLabel)('to use'),
            (0, utils_1.getToken)(token, amount),
            (0, utils_1.getLabel)('and')
        ])
            .flat()
            .slice(0, -1);
        return {
            fullVisualization: [
                (0, utils_1.getAction)('Approve'),
                ...permitVisualizations,
                (0, utils_1.getDeadline)(tm.message.sigDeadline)
            ]
        };
    }
    return { fullVisualization: [] };
};
exports.permit2Module = permit2Module;
//# sourceMappingURL=permit2Module.js.map