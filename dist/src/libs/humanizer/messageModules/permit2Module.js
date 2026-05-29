"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permit2Module = void 0;
const addresses_1 = require("../../../consts/addresses");
const utils_1 = require("../utils");
const permit2Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    if (!tm?.domain?.verifyingContract ||
        ![addresses_1.PERMIT_2_ADDRESS.toLowerCase(), addresses_1.PANCAKE_SWAP_PERMIT_2_ADDRESS.toLocaleLowerCase()].includes(tm.domain.verifyingContract.toLowerCase()))
        return { fullVisualization: [] };
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