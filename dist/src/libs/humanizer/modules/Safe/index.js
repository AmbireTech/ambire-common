"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSafeHumanization = exports.getDelegateCallWarning = exports.shouldDisplaySafeDelegateCallWarning = void 0;
const viem_1 = require("viem");
const safe_1 = require("../../../../consts/safe");
const accountOp_1 = require("../../../accountOp/accountOp");
const helpers_1 = require("../../../safe/helpers");
const utils_1 = require("../../utils");
const addOwnerWithThresholdAbi = (0, viem_1.parseAbi)([
    'function addOwnerWithThreshold(address owner, uint256 _threshold)'
]);
const changeThresholdAbi = (0, viem_1.parseAbi)(['function changeThreshold(uint256 _threshold)']);
const removeOwnerAbi = (0, viem_1.parseAbi)([
    'function removeOwner(address prevOwner, address owner, uint256 _threshold)'
]);
const swapOwnerAbi = (0, viem_1.parseAbi)([
    'function swapOwner(address prevOwner, address oldOwner, address newOwner)'
]);
const enableModuleAbi = (0, viem_1.parseAbi)(['function enableModule(address module)']);
const disableModuleAbi = (0, viem_1.parseAbi)(['function disableModule(address prevModule, address module)']);
const setGuardAbi = (0, viem_1.parseAbi)(['function setGuard(address guard)']);
const setFallbackHandlerAbi = (0, viem_1.parseAbi)(['function setFallbackHandler(address handler)']);
const setDomainVerifierAbi = (0, viem_1.parseAbi)([
    'function setDomainVerifier(bytes32 domainSeparator, address newVerifier)'
]);
const setupAbi = (0, viem_1.parseAbi)([
    'function setup(address[] _owners,uint256 _threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)'
]);
const execTransactionAbi = (0, viem_1.parseAbi)([
    'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'
]);
const multiSendAbi = (0, viem_1.parseAbi)(['function multiSend(bytes transactions)']);
const createProxyWithNonceAbi = (0, viem_1.parseAbi)([
    'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce)'
]);
// v1.5.0+: calls createProxyWithNonce internally, so it deploys the same way
const createProxyWithNonceL2Abi = (0, viem_1.parseAbi)([
    'function createProxyWithNonceL2(address _singleton, bytes initializer, uint256 saltNonce)'
]);
// shared recursion-depth guard for both nested `setup` hooks and nested `multiSend` batches,
// so a maliciously self-referential payload can't recurse getSafeHumanization indefinitely
const MAX_SAFE_SETUP_HOOK_DEPTH = 4;
const shouldDisplaySafeDelegateCallWarning = (operation, to) => BigInt(operation) === 1n &&
    (!to || !(0, viem_1.isAddress)(to) || !safe_1.allowedMulticallContracts.includes((0, viem_1.getAddress)(to)));
exports.shouldDisplaySafeDelegateCallWarning = shouldDisplaySafeDelegateCallWarning;
const getDelegateCallWarning = (operation, to) => {
    const warnings = [];
    if ((0, exports.shouldDisplaySafeDelegateCallWarning)(operation, to))
        warnings.push((0, utils_1.getWarning)('You are about to delegate permissions to a contract not whitelisted by Safe. Proceed with caution', 'SAFE{WALLET}_DELEGATE_CALL', undefined, to && (0, viem_1.isAddress)(to) ? (0, viem_1.getAddress)(to) : undefined));
    return warnings;
};
exports.getDelegateCallWarning = getDelegateCallWarning;
const setupSelector = (0, viem_1.toFunctionSelector)(setupAbi[0]);
const addOwnerWithThresholdSelector = (0, viem_1.toFunctionSelector)(addOwnerWithThresholdAbi[0]);
const changeThresholdSelector = (0, viem_1.toFunctionSelector)(changeThresholdAbi[0]);
const removeOwnerSelector = (0, viem_1.toFunctionSelector)(removeOwnerAbi[0]);
const swapOwnerSelector = (0, viem_1.toFunctionSelector)(swapOwnerAbi[0]);
const enableModuleSelector = (0, viem_1.toFunctionSelector)(enableModuleAbi[0]);
const disableModuleSelector = (0, viem_1.toFunctionSelector)(disableModuleAbi[0]);
const setGuardSelector = (0, viem_1.toFunctionSelector)(setGuardAbi[0]);
const setFallbackHandlerSelector = (0, viem_1.toFunctionSelector)(setFallbackHandlerAbi[0]);
const setDomainVerifierSelector = (0, viem_1.toFunctionSelector)(setDomainVerifierAbi[0]);
const multiSendSelector = (0, viem_1.toFunctionSelector)(multiSendAbi[0]);
const execTransactionSelector = (0, viem_1.toFunctionSelector)(execTransactionAbi[0]);
const createProxyWithNonceSelector = (0, viem_1.toFunctionSelector)(createProxyWithNonceAbi[0]);
const createProxyWithNonceL2Selector = (0, viem_1.toFunctionSelector)(createProxyWithNonceL2Abi[0]);
const getSafeHumanization = (safeAddr, to, value, data, setupHookDepth = 0, nonce) => {
    if (!data || !(0, viem_1.isHex)(data))
        return;
    const fullVisualization = [];
    const warnings = [];
    const selector = data.substring(0, 10);
    if (to !== undefined &&
        value !== undefined &&
        (0, accountOp_1.isSafeRejectionCall)([{ to, value: BigInt(value), data }], safeAddr ?? '')) {
        // a Safe{WALLET} "cancel" is just an empty, 0-value call to the zero address or to the
        // Safe itself, proposed with the same nonce as the transaction it is meant to replace, so
        // surface that nonce when it's known instead of showing a blank/empty call
        fullVisualization.push(...(nonce !== undefined && nonce !== null
            ? [(0, utils_1.getAction)('Cancel'), (0, utils_1.getLabel)('transaction with'), (0, utils_1.getLabel)(`nonce ${nonce}`, true)]
            : [(0, utils_1.getAction)('Cancel'), (0, utils_1.getLabel)('currently queued transaction')]));
        return {
            visuals: fullVisualization
        };
    }
    if (selector === setupSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: setupAbi, data });
        const [owners, threshold, setupTo, setupData, fallbackHandler, paymentToken, payment, paymentReceiver] = args;
        fullVisualization.push((0, utils_1.getAction)('Account setup'));
        if (owners.length) {
            fullVisualization.push((0, utils_1.getLabel)(owners.length === 1 ? 'Owner' : 'Owners'), ...owners.map((owner) => (0, utils_1.getAddressVisualization)(owner)));
        }
        fullVisualization.push((0, utils_1.getLabel)('Threshold'), (0, utils_1.getText)(threshold.toString()));
        if (fallbackHandler.toLowerCase() !== viem_1.zeroAddress) {
            fullVisualization.push((0, utils_1.getLabel)('Fallback handler'), (0, utils_1.getAddressVisualization)(fallbackHandler));
        }
        if (payment) {
            fullVisualization.push((0, utils_1.getLabel)('Payment'), (0, utils_1.getToken)(paymentToken, payment));
        }
        if (paymentReceiver.toLowerCase() !== viem_1.zeroAddress) {
            fullVisualization.push((0, utils_1.getLabel)('Payment receiver'), (0, utils_1.getAddressVisualization)(paymentReceiver));
        }
        if (setupHookDepth < MAX_SAFE_SETUP_HOOK_DEPTH &&
            setupTo.toLowerCase() !== viem_1.zeroAddress &&
            setupData !== '0x') {
            const setupCallHumanization = (0, exports.getSafeHumanization)(safeAddr, setupTo, 0n, setupData, setupHookDepth + 1);
            if (setupCallHumanization?.visuals?.length) {
                fullVisualization.push((0, utils_1.getBreak)(), (0, utils_1.getLabel)('Setup transaction'));
                fullVisualization.push(...setupCallHumanization.visuals);
            }
            if (setupCallHumanization?.warnings)
                warnings.push(...setupCallHumanization.warnings);
        }
        // `setup` can only ever succeed once per Safe proxy (the Safe contract itself guards
        // `setupOwners` against being called on an already-initialized account), so a decodable
        // `setup` call is always this account's creation, never a change to an existing one - nothing
        // to warn about here.
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    if (selector === createProxyWithNonceSelector || selector === createProxyWithNonceL2Selector) {
        const abi = selector === createProxyWithNonceSelector
            ? createProxyWithNonceAbi
            : createProxyWithNonceL2Abi;
        fullVisualization.push((0, utils_1.getAction)('Create Safe account'));
        // a malformed deployment call still gets the action label, only the details are skipped
        try {
            const { args } = (0, viem_1.decodeFunctionData)({ abi, data: (0, utils_1.padCallData)(data, 3) });
            const [, initializer] = args;
            const setupHumanization = setupHookDepth < MAX_SAFE_SETUP_HOOK_DEPTH
                ? (0, exports.getSafeHumanization)(safeAddr, to, 0n, initializer, setupHookDepth + 1)
                : undefined;
            if (setupHumanization?.visuals?.length) {
                fullVisualization.push((0, utils_1.getBreak)(), ...setupHumanization.visuals);
            }
            if (setupHumanization?.warnings)
                warnings.push(...setupHumanization.warnings);
        }
        catch {
            return { visuals: fullVisualization, warnings };
        }
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    if (selector === addOwnerWithThresholdSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: addOwnerWithThresholdAbi,
            data: (0, utils_1.padCallData)(data, 2)
        });
        const [newOwner, newThreshold] = args;
        fullVisualization.push(...[
            (0, utils_1.getAction)('Add owner'),
            (0, utils_1.getAddressVisualization)(newOwner),
            (0, utils_1.getAction)('and set threshold to'),
            (0, utils_1.getLabel)(newThreshold.toString())
        ]);
        warnings.push((0, utils_1.getWarning)(`Owner & threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE'));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    if (selector === changeThresholdSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: changeThresholdAbi, data: (0, utils_1.padCallData)(data, 1) });
        const [newThreshold] = args;
        fullVisualization.push(...[(0, utils_1.getAction)('Set threshold to'), (0, utils_1.getLabel)(newThreshold)]);
        warnings.push((0, utils_1.getWarning)(`Threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE'));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    if (selector === removeOwnerSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: removeOwnerAbi, data: (0, utils_1.padCallData)(data, 3) });
        const [, removedOwner, newThreshold] = args;
        fullVisualization.push(...[
            (0, utils_1.getAction)('Remove owner'),
            (0, utils_1.getAddressVisualization)(removedOwner),
            (0, utils_1.getAction)('and set threshold to'),
            (0, utils_1.getLabel)(newThreshold.toString())
        ]);
        warnings.push((0, utils_1.getWarning)(`Owner & threshold configuration changes detected`, 'SAFE{WALLET}_CONFIG_CHANGE'));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    if (selector === swapOwnerSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: swapOwnerAbi, data: (0, utils_1.padCallData)(data, 3) });
        const [, removedOwner, newOwner] = args;
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
    if (selector === enableModuleSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: enableModuleAbi, data: (0, utils_1.padCallData)(data, 1) });
        const [module] = args;
        fullVisualization.push(...[(0, utils_1.getAction)('Enable module:'), (0, utils_1.getAddressVisualization)(module)]);
        warnings.push((0, utils_1.getWarning)(`Modules can execute transactions if conditions are met`, 'SAFE{WALLET}_CONFIG_CHANGE'));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    if (selector === disableModuleSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: disableModuleAbi, data: (0, utils_1.padCallData)(data, 2) });
        const [, module] = args;
        fullVisualization.push(...[(0, utils_1.getAction)('Disable module:'), (0, utils_1.getAddressVisualization)(module)]);
        return {
            visuals: fullVisualization
        };
    }
    if (selector === setGuardSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: setGuardAbi, data: (0, utils_1.padCallData)(data, 1) });
        const [guard] = args;
        fullVisualization.push(...[(0, utils_1.getAction)('Set guard:'), (0, utils_1.getAddressVisualization)(guard)]);
        return {
            visuals: fullVisualization
        };
    }
    if (selector === setFallbackHandlerSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: setFallbackHandlerAbi,
            data: (0, utils_1.padCallData)(data, 1)
        });
        const [handler] = args;
        fullVisualization.push(...[(0, utils_1.getAction)('Extend your account functionality with'), (0, utils_1.getAddressVisualization)(handler)]);
        // The fallback handler controls how the Safe responds to calls it doesn't natively
        // implement, most importantly EIP-1271 `isValidSignature` checks, so swapping in
        // anything other than a known Safe default deserves explicit user attention
        if (handler.toLowerCase() !== viem_1.zeroAddress &&
            !safe_1.allowedFallbackHandlers.includes((0, viem_1.getAddress)(handler))) {
            warnings.push((0, utils_1.getWarning)('This adds new functionality to your account from a contract that is not a Safe default. Only proceed if you trust its source', 'SAFE{WALLET}_FALLBACK_HANDLER', undefined, (0, viem_1.getAddress)(handler)));
        }
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    if (selector === setDomainVerifierSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: setDomainVerifierAbi, data: (0, utils_1.padCallData)(data, 2) });
        const [, newVerifier] = args;
        fullVisualization.push(...[
            (0, utils_1.getAction)('Authorize custom access rights to your account for'),
            (0, utils_1.getAddressVisualization)(newVerifier)
        ]);
        // Grants the verifier contract standing authority to approve EIP-712 signed messages/orders
        // under this domain on behalf of the Safe, without further owner confirmation per action
        warnings.push((0, utils_1.getWarning)('This lets the contract above approve certain actions on behalf of your account automatically, without asking you each time. Only proceed if you trust it', 'SAFE{WALLET}_DOMAIN_VERIFIER', undefined, (0, viem_1.getAddress)(newVerifier)));
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    if (selector === multiSendSelector) {
        fullVisualization.push((0, utils_1.getAction)('Batch of transactions'));
        let decodedTransactions = [];
        try {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: multiSendAbi, data: (0, utils_1.padCallData)(data, 1) });
            const [transactions] = args;
            decodedTransactions = (0, helpers_1.decodeMultiSend)(transactions);
        }
        catch {
            decodedTransactions = [];
        }
        decodedTransactions.forEach((innerCall) => {
            if (!innerCall.success) {
                fullVisualization.push((0, utils_1.getBreak)(), (0, utils_1.getAction)('Failed to parse', { warning: true }));
                warnings.push((0, utils_1.getWarning)('Part of this batch could not be read and is not shown above. Proceed with caution', 'SAFE{WALLET}_MULTISEND_PARSE_FAILED'));
                return;
            }
            // a delegatecall leg runs attacker-controlled code directly in the Safe's own storage,
            // so it must be flagged the same way a top-level delegatecall would be, even though it's
            // hidden a level deeper inside this batch
            warnings.push(...(0, exports.getDelegateCallWarning)(innerCall.operation, innerCall.to));
            const innerHumanization = (0, exports.getSafeHumanization)(safeAddr, innerCall.to, innerCall.value, innerCall.data, setupHookDepth + 1);
            if (innerHumanization?.visuals?.length) {
                fullVisualization.push((0, utils_1.getBreak)(), ...innerHumanization.visuals);
            }
            if (innerHumanization?.warnings)
                warnings.push(...innerHumanization.warnings);
        });
        return {
            visuals: fullVisualization,
            warnings
        };
    }
    return undefined;
};
exports.getSafeHumanization = getSafeHumanization;
const SafeModule = (accOp, call) => {
    const matcher = {
        [execTransactionSelector]: (matchedCall) => {
            if (!matchedCall.to)
                return;
            if (matchedCall.value)
                return;
            let args;
            try {
                args = [...(0, viem_1.decodeFunctionData)({ abi: execTransactionAbi, data: matchedCall.data }).args];
            }
            catch {
                return;
            }
            const [to, value, data, operation] = args;
            if (typeof to !== 'string')
                return;
            if (typeof data !== 'string')
                return;
            if (typeof value !== 'bigint' && typeof value !== 'number' && typeof value !== 'string')
                return;
            if (typeof operation !== 'bigint' &&
                typeof operation !== 'number' &&
                typeof operation !== 'string')
                return;
            const bigintValue = BigInt(value);
            const bigintOperation = BigInt(operation);
            // this decoded call is a nested `execTransaction` invocation (e.g. a relayer executing on
            // behalf of the Safe), so `accOp.nonce` does not necessarily reflect this inner Safe
            // transaction's nonce and is intentionally not passed here
            const safeSpecificHumanization = (0, exports.getSafeHumanization)(accOp.accountAddr, to, bigintValue, data, 0, accOp.nonce);
            const fullVisualization = [
                (0, utils_1.getAction)('Execute a Safe{WALLET} transaction'),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(matchedCall.to),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(to)
            ];
            if (bigintValue)
                fullVisualization.push(...[(0, utils_1.getLabel)('and'), (0, utils_1.getAction)('Send'), (0, utils_1.getToken)(viem_1.zeroAddress, bigintValue)]);
            const warnings = [];
            if (safeSpecificHumanization) {
                if (safeSpecificHumanization.visuals)
                    fullVisualization.push((0, utils_1.getBreak)(), ...safeSpecificHumanization.visuals);
                if (safeSpecificHumanization.warnings)
                    warnings.push(...safeSpecificHumanization.warnings);
            }
            const delegateCallWarnings = (0, exports.getDelegateCallWarning)(bigintOperation, to);
            if (delegateCallWarnings.length)
                warnings.push(...delegateCallWarnings);
            return { ...matchedCall, fullVisualization, warnings };
        }
    };
    let newCall = call;
    const safeSpecificHumanization = (0, exports.getSafeHumanization)(accOp.accountAddr, call.to, call.value, call.data, 0, accOp.nonce);
    if (safeSpecificHumanization) {
        newCall = {
            ...call,
            fullVisualization: safeSpecificHumanization.visuals,
            warnings: safeSpecificHumanization.warnings
        };
    }
    else if ((0, utils_1.isHexCall)(call)) {
        const match = matcher[call.data.slice(0, 10)];
        if (!call.fullVisualization && match) {
            const matchedCall = match(call);
            if (matchedCall)
                newCall = matchedCall;
        }
    }
    return newCall;
};
exports.default = SafeModule;
//# sourceMappingURL=index.js.map