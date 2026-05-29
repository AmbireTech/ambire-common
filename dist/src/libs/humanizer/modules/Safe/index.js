"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSafeHumanization = exports.getDelegateCallWarning = void 0;
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const safe_1 = require("../../../../consts/safe");
const Safe_1 = require("../../const/abis/Safe");
const utils_1 = require("../../utils");
const iface = new ethers_1.Interface(Safe_1.SafeV2);
const getDelegateCallWarning = (operation, to) => {
    const warnings = [];
    if (operation === 1n &&
        (!to || !(0, ethers_1.isAddress)(to) || !safe_1.allowedMulticallContracts.includes((0, ethers_1.getAddress)(to))))
        warnings.push((0, utils_1.getWarning)('You are about to delegate permissions to a contract not whitelisted by Safe. Proceed with caution', 'SAFE{WALLET}_DELEGATE_CALL'));
    return warnings;
};
exports.getDelegateCallWarning = getDelegateCallWarning;
const getSafeHumanization = (safeAddr, to, value, data) => {
    if (!data)
        return;
    const fullVisualization = [];
    const warnings = [];
    if (to &&
        safeAddr &&
        to.toLowerCase() === safeAddr.toLowerCase() &&
        value?.toString() === '0' &&
        data === '0x') {
        fullVisualization.push(...[(0, utils_1.getAction)('Reject currently queued transaction')]);
        return {
            visuals: fullVisualization
        };
    }
    const selector = data.substring(0, 10);
    const addOwnerWithThreshold = iface.getFunction('addOwnerWithThreshold')?.selector;
    if (selector === addOwnerWithThreshold) {
        const decoded = iface.decodeFunctionData('addOwnerWithThreshold', data);
        const newOwner = decoded[0];
        const newThreshold = decoded[1];
        fullVisualization.push(...[
            (0, utils_1.getAction)('Add owner'),
            (0, utils_1.getAddressVisualization)(newOwner),
            (0, utils_1.getAction)('and set threshold to'),
            (0, utils_1.getLabel)(newThreshold)
        ]);
        warnings.push((0, utils_1.getWarning)(`Owner & threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE'));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    const changeThreshold = iface.getFunction('changeThreshold')?.selector;
    if (selector === changeThreshold) {
        const decoded = iface.decodeFunctionData('changeThreshold', data);
        const newThreshold = decoded[0];
        fullVisualization.push(...[(0, utils_1.getAction)('Set threshold to'), (0, utils_1.getLabel)(newThreshold)]);
        warnings.push((0, utils_1.getWarning)(`Threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE'));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    const removeOwner = iface.getFunction('removeOwner')?.selector;
    if (selector === removeOwner) {
        const decoded = iface.decodeFunctionData('removeOwner', data);
        const removedOwner = decoded[1];
        const newThreshold = decoded[2];
        fullVisualization.push(...[
            (0, utils_1.getAction)('Remove owner'),
            (0, utils_1.getAddressVisualization)(removedOwner),
            (0, utils_1.getAction)('and set threshold to'),
            (0, utils_1.getLabel)(newThreshold)
        ]);
        warnings.push((0, utils_1.getWarning)(`Owner & threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE'));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    const swapOwner = iface.getFunction('swapOwner')?.selector;
    if (selector === swapOwner) {
        const decoded = iface.decodeFunctionData('swapOwner', data);
        const removedOwner = decoded[1];
        const newOwner = decoded[2];
        fullVisualization.push(...[
            (0, utils_1.getAction)('Remove owner'),
            (0, utils_1.getAddressVisualization)(removedOwner),
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Set new owner'),
            (0, utils_1.getAddressVisualization)(newOwner)
        ]);
        warnings.push((0, utils_1.getWarning)(`Owner configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE'));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    const enableModule = iface.getFunction('enableModule')?.selector;
    if (selector === enableModule) {
        const decoded = iface.decodeFunctionData('enableModule', data);
        const module = decoded[0];
        fullVisualization.push(...[(0, utils_1.getAction)('Enable module:'), (0, utils_1.getAddressVisualization)(module)]);
        warnings.push((0, utils_1.getWarning)(`Modules can execute transactions if conditions are met`, 'SAFE{WALLET}_CONFIG_CHANGE'));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    const disableModule = iface.getFunction('disableModule')?.selector;
    if (selector === disableModule) {
        const decoded = iface.decodeFunctionData('disableModule', data);
        const module = decoded[1];
        fullVisualization.push(...[(0, utils_1.getAction)('Disable module:'), (0, utils_1.getAddressVisualization)(module)]);
        return {
            visuals: fullVisualization
        };
    }
    const setGuard = iface.getFunction('setGuard')?.selector;
    if (selector === setGuard) {
        const decoded = iface.decodeFunctionData('setGuard', data);
        const guard = decoded[0];
        fullVisualization.push(...[(0, utils_1.getAction)('Set guard:'), (0, utils_1.getAddressVisualization)(guard)]);
        return {
            visuals: fullVisualization
        };
    }
    return undefined;
};
exports.getSafeHumanization = getSafeHumanization;
const SafeModule = (accOp, calls) => {
    const matcher = {
        [iface.getFunction('function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)')?.selector]: (call) => {
            if (!call.to)
                return;
            if (call.value)
                return;
            const { to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures } = iface.parseTransaction(call).args;
            const safeSpecificHumanization = (0, exports.getSafeHumanization)(accOp.accountAddr, to, value, data);
            const fullVisualization = [
                (0, utils_1.getAction)('Execute a Safe{WALLET} transaction'),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(call.to),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(to)
            ];
            if (value)
                fullVisualization.push(...[(0, utils_1.getLabel)('and'), (0, utils_1.getAction)('Send'), (0, utils_1.getToken)(ethers_1.ZeroAddress, value)]);
            const warnings = [];
            if (safeSpecificHumanization) {
                if (safeSpecificHumanization.visuals)
                    fullVisualization.push((0, utils_1.getBreak)(), ...safeSpecificHumanization.visuals);
                if (safeSpecificHumanization.warnings)
                    warnings.push(...safeSpecificHumanization.warnings);
            }
            const delegateCallWarnings = (0, exports.getDelegateCallWarning)(operation, to);
            if (delegateCallWarnings.length)
                warnings.push(...delegateCallWarnings);
            return { ...call, fullVisualization, warnings };
        }
    };
    const newCalls = calls.map((call) => {
        const safeSpecificHumanization = (0, exports.getSafeHumanization)(accOp.accountAddr, call.to, call.value, call.data);
        if (safeSpecificHumanization) {
            return {
                ...call,
                fullVisualization: safeSpecificHumanization.visuals,
                warnings: safeSpecificHumanization.warnings
            };
        }
        const match = matcher[call.data.slice(0, 10)];
        if (call.fullVisualization || !match)
            return call;
        const newCall = match(call);
        if (!newCall)
            return call;
        return newCall;
    });
    if (accOp.safeTx) {
        const warningInSafeTx = (0, exports.getDelegateCallWarning)(BigInt(accOp.safeTx.operation), accOp.safeTx.to);
        if (warningInSafeTx.length && newCalls.length) {
            const firstCall = newCalls[0];
            const firstCallWarnings = firstCall.warnings || [];
            warningInSafeTx.push(...firstCallWarnings);
            firstCall.warnings = warningInSafeTx;
        }
    }
    return newCalls;
};
exports.default = SafeModule;
//# sourceMappingURL=index.js.map