"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSetAllowanceResetText = exports.getAllowanceResetText = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const setAllowanceAbi = (0, viem_1.parseAbi)([
    'function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)'
]);
const deleteAllowanceAbi = (0, viem_1.parseAbi)(['function deleteAllowance(address delegate, address token)']);
const executeAllowanceTransferAbi = (0, viem_1.parseAbi)([
    'function executeAllowanceTransfer(address safe, address token, address to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes memory signature)'
]);
const addDelegateAbi = (0, viem_1.parseAbi)(['function addDelegate(address delegate)']);
const removeDelegateAbi = (0, viem_1.parseAbi)([
    'function removeDelegate(address delegate, bool removeAllowances)'
]);
const getAllowanceResetText = (resetTimeMin) => {
    if (resetTimeMin === 0n)
        return 'No reset';
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
exports.getAllowanceResetText = getAllowanceResetText;
const setAllowanceSelector = (0, viem_1.toFunctionSelector)(setAllowanceAbi[0]);
const addDelegateSelector = (0, viem_1.toFunctionSelector)(addDelegateAbi[0]);
const removeDelegateSelector = (0, viem_1.toFunctionSelector)(removeDelegateAbi[0]);
const deleteAllowanceSelector = (0, viem_1.toFunctionSelector)(deleteAllowanceAbi[0]);
const executeAllowanceTransferSelector = (0, viem_1.toFunctionSelector)(executeAllowanceTransferAbi[0]);
const getSetAllowanceResetText = (call) => {
    if (!(0, utils_1.isHexCall)(call))
        return null;
    if (call.data.slice(0, 10) !== setAllowanceSelector)
        return null;
    const { args } = (0, viem_1.decodeFunctionData)({ abi: setAllowanceAbi, data: call.data });
    const [, , , resetTimeMin] = args;
    return (0, exports.getAllowanceResetText)(BigInt(resetTimeMin));
};
exports.getSetAllowanceResetText = getSetAllowanceResetText;
const AllowanceModule = (accOp, call) => {
    const matcher = {
        [setAllowanceSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: setAllowanceAbi, data: call.data });
            const [delegate, token, allowanceAmount, resetTimeMin] = args;
            const fullVisualization = [
                (0, utils_1.getAction)('Allow'),
                (0, utils_1.getAddressVisualization)(delegate),
                (0, utils_1.getLabel)('to spend'),
                (0, utils_1.getToken)(token, allowanceAmount),
                (0, utils_1.getLabel)((0, exports.getAllowanceResetText)(BigInt(resetTimeMin)))
            ];
            return { ...call, fullVisualization };
        },
        [addDelegateSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: addDelegateAbi, data: call.data });
            const [delegate] = args;
            const fullVisualization = [(0, utils_1.getAction)('Add delegate'), (0, utils_1.getAddressVisualization)(delegate)];
            return { ...call, fullVisualization };
        },
        [removeDelegateSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: removeDelegateAbi, data: call.data });
            const [delegate, removeAllowances] = args;
            const fullVisualization = [(0, utils_1.getAction)('Remove delegate'), (0, utils_1.getAddressVisualization)(delegate)];
            if (removeAllowances)
                fullVisualization.push((0, utils_1.getLabel)('and set allowance to 0'));
            return { ...call, fullVisualization };
        },
        [deleteAllowanceSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: deleteAllowanceAbi, data: call.data });
            const [delegate, token] = args;
            const fullVisualization = [
                (0, utils_1.getAction)('Remove allowance for'),
                (0, utils_1.getAddressVisualization)(delegate),
                (0, utils_1.getToken)(token, 0n)
            ];
            return { ...call, fullVisualization };
        },
        [executeAllowanceTransferSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: executeAllowanceTransferAbi,
                data: call.data
            });
            const [, token, , amount, , , delegate] = args;
            const fullVisualization = [
                (0, utils_1.getAction)('Execute allowance for'),
                (0, utils_1.getAddressVisualization)(delegate),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(token, amount)
            ];
            return { ...call, fullVisualization };
        }
    };
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call))
        return call;
    const match = matcher[call.data.slice(0, 10)];
    if (!match)
        return call;
    const newCall = match(call);
    if (!newCall)
        return call;
    return newCall;
};
exports.default = AllowanceModule;
//# sourceMappingURL=index.js.map