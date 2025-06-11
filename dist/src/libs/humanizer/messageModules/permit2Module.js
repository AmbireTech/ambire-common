"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permit2Module = void 0;
const addresses_1 = require("../../../consts/addresses");
const utils_1 = require("../utils");
const getPermitData = (permit) => {
    return { token: permit.token, amount: permit.amount };
};
const permit2Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    if (tm?.domain?.verifyingContract &&
        [addresses_1.PERMIT_2_ADDRESS.toLowerCase(), addresses_1.PANCAKE_SWAP_PERMIT_2_ADDRESS.toLocaleLowerCase()].includes(tm.domain.verifyingContract.toLowerCase())) {
        const messageType = tm?.types?.PermitSingle?.[0]?.type || tm?.types?.PermitBatch?.[0]?.type;
        if (!['PermitDetails', 'PermitDetails[]'].includes(messageType))
            return { fullVisualization: [] };
        const permits = messageType === 'PermitDetails'
            ? [getPermitData(tm.message.details)]
            : tm.message.details.map((permitDetails) => getPermitData(permitDetails));
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