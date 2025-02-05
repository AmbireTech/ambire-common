"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permit2Module = void 0;
const addresses_1 = require("../../../consts/addresses");
const utils_1 = require("../utils");
const visualizePermit = (permit) => {
    return [
        (0, utils_1.getAction)('Permit'),
        (0, utils_1.getAddressVisualization)(addresses_1.PERMIT_2_ADDRESS),
        (0, utils_1.getLabel)('to use'),
        (0, utils_1.getToken)(permit.token, permit.amount),
        (0, utils_1.getLabel)('for time period'),
        (0, utils_1.getDeadline)(permit.expiration)
    ];
};
const permit2Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    const visualizations = [];
    if (tm?.domain?.verifyingContract &&
        tm.domain.verifyingContract.toLowerCase() === addresses_1.PERMIT_2_ADDRESS.toLowerCase()) {
        if (tm?.types?.PermitSingle?.[0]?.type === 'PermitDetails') {
            visualizations.push(...visualizePermit(tm.message.details), (0, utils_1.getLabel)('this whole signatuere'), (0, utils_1.getDeadline)(tm.message.sigDeadline));
        }
        else if (tm?.types?.PermitBatch?.[0]?.type === 'PermitDetails[]') {
            tm.message.details.forEach((permitDetails, i) => {
                visualizations.push(...[
                    (0, utils_1.getLabel)(`Permit #${i + 1}`),
                    ...visualizePermit(permitDetails),
                    (0, utils_1.getLabel)('this whole signatuere'),
                    (0, utils_1.getDeadline)(tm.message.sigDeadline)
                ]);
            });
        }
        return { fullVisualization: visualizations };
    }
    return { fullVisualization: [] };
};
exports.permit2Module = permit2Module;
//# sourceMappingURL=permit2Module.js.map