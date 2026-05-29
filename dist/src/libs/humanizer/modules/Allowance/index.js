"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const Allowance_1 = require("../../const/abis/Allowance");
const utils_1 = require("../../utils");
const iface = new ethers_1.Interface(Allowance_1.Allowance);
const getTimeString = (resetTimeMin) => {
    if (resetTimeMin === 1440n)
        return 'Daily';
    if (resetTimeMin === 10080n)
        return 'Weekly';
    if (resetTimeMin === 20160n)
        return 'Biweekly';
    if (resetTimeMin === 43200n)
        return 'Monthly';
    return `Every ${resetTimeMin.toString()} minutes`;
};
const AllowanceModule = (accOp, calls) => {
    const matcher = {
        [iface.getFunction('setAllowance')?.selector]: (call) => {
            const { delegate, token, allowanceAmount, resetTimeMin, resetBaseMin } = iface.parseTransaction(call).args;
            const fullVisualization = [
                (0, utils_1.getAction)('Allow'),
                (0, utils_1.getAddressVisualization)(delegate),
                (0, utils_1.getLabel)('to spend'),
                (0, utils_1.getToken)(token, allowanceAmount),
                (0, utils_1.getLabel)(getTimeString(resetTimeMin))
            ];
            return { ...call, fullVisualization };
        },
        [iface.getFunction('addDelegate')?.selector]: (call) => {
            const { delegate } = iface.parseTransaction(call).args;
            const fullVisualization = [(0, utils_1.getAction)('Add delegate'), (0, utils_1.getAddressVisualization)(delegate)];
            return { ...call, fullVisualization };
        },
        [iface.getFunction('removeDelegate')?.selector]: (call) => {
            const { delegate, removeAllowances } = iface.parseTransaction(call).args;
            const fullVisualization = [(0, utils_1.getAction)('Remove delegate'), (0, utils_1.getAddressVisualization)(delegate)];
            if (removeAllowances)
                fullVisualization.push((0, utils_1.getLabel)('and set allowance to 0'));
            return { ...call, fullVisualization };
        },
        [iface.getFunction('deleteAllowance')?.selector]: (call) => {
            const { delegate, token } = iface.parseTransaction(call).args;
            const fullVisualization = [
                (0, utils_1.getAction)('Remove allowance for'),
                (0, utils_1.getAddressVisualization)(delegate),
                (0, utils_1.getToken)(token, 0n)
            ];
            return { ...call, fullVisualization };
        },
        [iface.getFunction('executeAllowanceTransfer')?.selector]: (call) => {
            const { safe, token, to, amount, paymentToken, payment, delegate, signature } = iface.parseTransaction(call).args;
            const fullVisualization = [
                (0, utils_1.getAction)('Execute allowance for'),
                (0, utils_1.getAddressVisualization)(delegate),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(token, amount)
            ];
            return { ...call, fullVisualization };
        }
    };
    const newCalls = calls.map((call) => {
        const match = matcher[call.data.slice(0, 10)];
        if (call.fullVisualization || !match)
            return call;
        const newCall = match(call);
        if (!newCall)
            return call;
        return newCall;
    });
    return newCalls;
};
exports.default = AllowanceModule;
//# sourceMappingURL=index.js.map