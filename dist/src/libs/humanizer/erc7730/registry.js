"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveErc7730MessageDescriptor = exports.planErc7730MessageWants = exports.resolveErc7730Message = exports.resolveErc7730Descriptors = exports.planErc7730Wants = exports.resolveErc7730Call = exports.selectEip712IndexEntry = exports.getAddressFromStorageSlot = exports.normalizeRelayerPath = exports.validateDescriptor = exports.validateEip712Index = exports.validateCalldataIndex = exports.ERC7730_MAX_RESOLUTION_DEPTH = void 0;
const ethers_1 = require("ethers");
const consts_1 = require("./consts");
const addresses_1 = require("../../../consts/addresses");
const safe_1 = require("../../../consts/safe");
const decodeCall_1 = require("../../decodeCall");
const helpers_1 = require("../../safe/helpers");
const calldata_1 = require("./calldata");
const eip712_1 = require("./eip712");
const humanize_1 = require("./humanize");
const multicall_1 = require("./multicall");
const utils_1 = require("./utils");
/** How deep `includes` chains and nested calls are followed before giving up. */
exports.ERC7730_MAX_RESOLUTION_DEPTH = 5;
const safeExecTransactionInterface = new ethers_1.Interface(safe_1.execTransactionAbi);
const safeExecTransactionSelector = safeExecTransactionInterface.getFunction('execTransaction')?.selector;
const erc20ApproveInterface = new ethers_1.Interface(['function approve(address _spender, uint256 _value)']);
const erc20TransferInterface = new ethers_1.Interface(['function transfer(address _to, uint256 _value)']);
const permit2ApproveInterface = new ethers_1.Interface([
    'function approve(address token, address spender, uint160 amount, uint48 expiration)'
]);
const ABI_WORD_HEX_LENGTH = 64;
const EXEC_TRANSACTION_STATIC_WORDS = 10;
const ERC2612_PERMIT_ENCODE_TYPE_HASH = '0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9';
const isDecimalString = (value) => !!value && [...value].every((char) => char >= '0' && char <= '9');
const isRegistryKey = (key) => {
    const parts = key.split(':');
    return (parts.length === 3 &&
        parts[0] === 'eip155' &&
        isDecimalString(parts[1]) &&
        (0, utils_1.isHexOfLength)(parts[2], 40));
};
const isHexHash = (value) => (0, utils_1.isHexOfLength)(value, 64);
function throwInvalidRelayerResource(path) {
    throw new Error(`Invalid ERC-7730 relayer resource response: ${path}`);
}
const validateCalldataIndex = (payload, path) => {
    if (!(0, utils_1.isPlainObject)(payload))
        throwInvalidRelayerResource(path);
    const index = payload;
    Object.entries(index).forEach(([key, value]) => {
        if (!isRegistryKey(key) || typeof value !== 'string')
            throwInvalidRelayerResource(path);
    });
    return true;
};
exports.validateCalldataIndex = validateCalldataIndex;
const validateEip712IndexEntry = (entry, path) => {
    if (!(0, utils_1.isPlainObject)(entry))
        throwInvalidRelayerResource(path);
    const indexEntry = entry;
    if (typeof indexEntry.path !== 'string')
        throwInvalidRelayerResource(path);
    const { encodeTypeHashes } = indexEntry;
    if (encodeTypeHashes !== undefined &&
        (!Array.isArray(encodeTypeHashes) ||
            encodeTypeHashes.some((hash) => typeof hash !== 'string' || !isHexHash(hash)))) {
        throwInvalidRelayerResource(path);
    }
    return true;
};
const validateEip712Index = (payload, path) => {
    if (!(0, utils_1.isPlainObject)(payload))
        throwInvalidRelayerResource(path);
    const index = payload;
    Object.entries(index).forEach(([registryKey, primaryTypes]) => {
        if (!isRegistryKey(registryKey) || !(0, utils_1.isPlainObject)(primaryTypes)) {
            throwInvalidRelayerResource(path);
        }
        const primaryTypesIndex = primaryTypes;
        Object.entries(primaryTypesIndex).forEach(([primaryType, entries]) => {
            if (typeof primaryType !== 'string' || !Array.isArray(entries)) {
                throwInvalidRelayerResource(path);
            }
            const indexEntries = entries;
            indexEntries.forEach((entry) => validateEip712IndexEntry(entry, path));
        });
    });
    return true;
};
exports.validateEip712Index = validateEip712Index;
const validateDescriptorField = (field, path) => {
    if (!(0, utils_1.isPlainObject)(field))
        throwInvalidRelayerResource(path);
    const descriptorField = field;
    if (descriptorField.path !== undefined && typeof descriptorField.path !== 'string')
        throwInvalidRelayerResource(path);
    if (descriptorField.label !== undefined && typeof descriptorField.label !== 'string')
        throwInvalidRelayerResource(path);
    if (descriptorField.format !== undefined && typeof descriptorField.format !== 'string') {
        throwInvalidRelayerResource(path);
    }
    const { encryption } = descriptorField;
    if (encryption !== undefined) {
        if (!(0, utils_1.isPlainObject)(encryption))
            throwInvalidRelayerResource(path);
        if (encryption.fallbackLabel !== undefined && typeof encryption.fallbackLabel !== 'string')
            throwInvalidRelayerResource(path);
    }
    const { fields } = descriptorField;
    if (fields !== undefined) {
        if (!Array.isArray(fields))
            throwInvalidRelayerResource(path);
        const nestedFields = fields;
        nestedFields.forEach((nestedField) => validateDescriptorField(nestedField, path));
    }
    return true;
};
const validateDescriptor = (payload, path) => {
    if (!(0, utils_1.isPlainObject)(payload))
        throwInvalidRelayerResource(path);
    const descriptor = payload;
    const { includes } = descriptor;
    if (includes !== undefined &&
        typeof includes !== 'string' &&
        (!Array.isArray(includes) ||
            includes.some((includePath) => typeof includePath !== 'string'))) {
        throwInvalidRelayerResource(path);
    }
    const { display } = descriptor;
    if (display === undefined)
        return true;
    if (!(0, utils_1.isPlainObject)(display))
        throwInvalidRelayerResource(path);
    const { formats, definitions } = display;
    if (definitions !== undefined && !(0, utils_1.isPlainObject)(definitions))
        throwInvalidRelayerResource(path);
    if (formats === undefined)
        return true;
    if (!(0, utils_1.isPlainObject)(formats))
        throwInvalidRelayerResource(path);
    const descriptorFormats = formats;
    Object.values(descriptorFormats).forEach((format) => {
        if (!(0, utils_1.isPlainObject)(format))
            throwInvalidRelayerResource(path);
        const descriptorFormat = format;
        if (descriptorFormat.intent !== undefined && typeof descriptorFormat.intent !== 'string') {
            throwInvalidRelayerResource(path);
        }
        const { fields } = descriptorFormat;
        if (fields === undefined)
            return;
        if (!Array.isArray(fields))
            throwInvalidRelayerResource(path);
        const descriptorFields = fields;
        descriptorFields.forEach((field) => validateDescriptorField(field, path));
    });
    return true;
};
exports.validateDescriptor = validateDescriptor;
const getErc20ApproveDescriptor = (path, intent, spenderLabel) => ({
    path,
    descriptor: {
        display: {
            formats: {
                'approve(address _spender, uint256 _value)': {
                    intent,
                    fields: [
                        {
                            path: '#._spender',
                            label: spenderLabel,
                            format: 'addressName',
                            visible: 'always'
                        },
                        {
                            path: '#._value',
                            label: 'Amount',
                            format: 'tokenAmount',
                            params: { tokenPath: '@.to' },
                            visible: 'always'
                        }
                    ]
                }
            }
        }
    }
});
const ERC20_APPROVE_DESCRIPTOR = getErc20ApproveDescriptor('built-in/erc20-approve', 'Approve', 'Spender');
const ERC20_REVOKE_APPROVAL_DESCRIPTOR = getErc20ApproveDescriptor('built-in/erc20-revoke-approval', 'Revoke approval', 'Spender');
const ERC20_TRANSFER_DESCRIPTOR = {
    path: 'built-in/erc20-transfer',
    descriptor: {
        display: {
            formats: {
                'transfer(address _to, uint256 _value)': {
                    intent: 'Send',
                    fields: [
                        {
                            path: '_value',
                            label: 'Amount',
                            format: 'tokenAmount',
                            params: { tokenPath: '@.to' },
                            visible: 'always'
                        },
                        {
                            path: '_to',
                            label: 'To',
                            format: 'addressName',
                            params: { types: ['eoa'], sources: ['local', 'ens'] },
                            visible: 'always'
                        }
                    ]
                }
            }
        }
    }
};
const getPermit2ApproveDescriptor = (path, intent) => ({
    path,
    descriptor: {
        display: {
            formats: {
                'approve(address token, address spender, uint160 amount, uint48 expiration)': {
                    intent,
                    fields: [
                        {
                            path: '#.spender',
                            label: 'Spender',
                            format: 'addressName',
                            visible: 'always'
                        },
                        {
                            path: '#.amount',
                            label: 'Amount',
                            format: 'tokenAmount',
                            params: { tokenPath: '#.token' },
                            visible: 'always'
                        },
                        {
                            path: '#.expiration',
                            label: 'Approval expires',
                            format: 'date',
                            params: { encoding: 'timestamp' },
                            visible: 'always'
                        }
                    ]
                }
            }
        }
    }
});
const PERMIT2_APPROVE_DESCRIPTOR = getPermit2ApproveDescriptor('built-in/permit2-approve', 'Approve');
const PERMIT2_REVOKE_APPROVAL_DESCRIPTOR = getPermit2ApproveDescriptor('built-in/permit2-revoke-approval', 'Revoke approval');
const ERC2612_PERMIT_DESCRIPTOR = {
    path: 'built-in/erc2612-permit',
    descriptor: {
        display: {
            formats: {
                'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)': {
                    intent: 'Authorize spending of tokens',
                    fields: [
                        {
                            path: 'spender',
                            label: 'Spender',
                            format: 'raw',
                            visible: 'always'
                        },
                        {
                            path: 'value',
                            label: 'Max spending amount',
                            format: 'tokenAmount',
                            params: { tokenPath: '@.to' },
                            visible: 'always'
                        },
                        {
                            path: 'deadline',
                            label: 'Valid until',
                            format: 'date',
                            params: { encoding: 'timestamp' }
                        },
                        {
                            path: 'owner',
                            label: 'Owner',
                            visible: 'never'
                        },
                        {
                            path: 'nonce',
                            label: 'Nonce',
                            visible: 'never'
                        }
                    ]
                }
            }
        }
    }
};
const normalizeRelayerPath = (pathOrUrl) => {
    try {
        const url = new URL(pathOrUrl);
        return `${url.pathname}${url.search}`;
    }
    catch {
        return pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    }
};
exports.normalizeRelayerPath = normalizeRelayerPath;
const getIncludePath = (includePath, parentPath) => {
    if (includePath.startsWith('/') ||
        includePath.startsWith('http://') ||
        includePath.startsWith('https://')) {
        return (0, exports.normalizeRelayerPath)(includePath);
    }
    return new URL(includePath, `https://relayer.local${(0, exports.normalizeRelayerPath)(parentPath)}`).pathname;
};
const mergeDescriptors = (base, override) => {
    const merge = (left, right) => {
        if ((0, utils_1.isPlainObject)(left) && (0, utils_1.isPlainObject)(right)) {
            return Object.keys(right).reduce((acc, key) => ({
                ...acc,
                [key]: merge(acc[key], right[key])
            }), { ...left });
        }
        return right === undefined ? left : right;
    };
    return merge(base, override);
};
const applyBuiltInFormatOverrides = (descriptor, builtInDescriptor) => {
    const formats = descriptor.display?.formats;
    const builtInFormats = builtInDescriptor.descriptor.display?.formats;
    if (!formats || !builtInFormats)
        return descriptor;
    Object.entries(builtInFormats).forEach(([signature, builtInFormat]) => {
        const format = formats[signature];
        if (!format)
            return;
        if (builtInDescriptor.path?.endsWith('-revoke-approval')) {
            format.intent = builtInFormat.intent;
        }
        const nativeField = builtInFormat.fields?.find((field) => field.path === '@.value' && field.label === 'Send');
        if (!nativeField)
            return;
        const fields = format.fields || [];
        if (fields.some((field) => field.path === nativeField.path && field.label === nativeField.label))
            return;
        format.fields = [...fields, nativeField];
    });
    return descriptor;
};
const isErc20TransferToFeeCollector = (call) => {
    if (!call.data || call.data.slice(0, 10).toLowerCase() !== consts_1.ERC20_TRANSFER_SELECTOR)
        return false;
    try {
        const [to] = erc20TransferInterface.decodeFunctionData('transfer', call.data);
        return typeof to === 'string' && to.toLowerCase() === addresses_1.FEE_COLLECTOR.toLowerCase();
    }
    catch {
        return false;
    }
};
const getBuiltInDescriptorForCall = (call) => {
    if (!call.data || !(0, ethers_1.isHexString)(call.data))
        return null;
    const selector = call.data.slice(0, 10).toLowerCase();
    if (selector === consts_1.ERC20_APPROVE_SELECTOR) {
        try {
            const [, value] = erc20ApproveInterface.decodeFunctionData('approve', call.data);
            return value === 0n ? ERC20_REVOKE_APPROVAL_DESCRIPTOR : ERC20_APPROVE_DESCRIPTOR;
        }
        catch {
            return ERC20_APPROVE_DESCRIPTOR;
        }
    }
    if (selector === consts_1.ERC20_TRANSFER_SELECTOR)
        return ERC20_TRANSFER_DESCRIPTOR;
    if (selector === multicall_1.MULTICALL_SELECTOR)
        return multicall_1.MULTICALL_DESCRIPTOR;
    if (call.to &&
        call.to.toLowerCase() === consts_1.PERMIT2_ADDRESS &&
        selector === consts_1.PERMIT2_APPROVE_SELECTOR) {
        try {
            const [, , amount] = permit2ApproveInterface.decodeFunctionData('approve', call.data);
            return amount === 0n ? PERMIT2_REVOKE_APPROVAL_DESCRIPTOR : PERMIT2_APPROVE_DESCRIPTOR;
        }
        catch {
            return PERMIT2_APPROVE_DESCRIPTOR;
        }
    }
    return null;
};
const getBuiltInDescriptorForMessage = (message) => {
    if (message.content.kind !== 'typedMessage' || message.content.primaryType !== 'Permit')
        return null;
    try {
        const encodeTypeHash = (0, eip712_1.getEip712EncodeTypeHash)(message.content.types, message.content.primaryType);
        return encodeTypeHash === ERC2612_PERMIT_ENCODE_TYPE_HASH ? ERC2612_PERMIT_DESCRIPTOR : null;
    }
    catch {
        return null;
    }
};
const getTypedMessageChainId = (message) => {
    if (message.content.kind !== 'typedMessage')
        return null;
    try {
        return BigInt(message.content.domain.chainId ?? message.chainId);
    }
    catch {
        return null;
    }
};
const getAbiWord = (data, wordIndex) => {
    const wordStart = decodeCall_1.CALLDATA_SELECTOR_HEX_LENGTH + wordIndex * ABI_WORD_HEX_LENGTH;
    const wordEnd = wordStart + ABI_WORD_HEX_LENGTH;
    if (data.length < wordEnd)
        return null;
    return data.slice(wordStart, wordEnd);
};
const getAbiWordAsBigInt = (data, wordIndex) => {
    const word = getAbiWord(data, wordIndex);
    if (!word)
        return null;
    try {
        return BigInt(`0x${word}`);
    }
    catch {
        return null;
    }
};
const getAbiWordAsAddress = (data, wordIndex) => {
    const word = getAbiWord(data, wordIndex);
    if (!word)
        return null;
    const address = `0x${word.slice(-40)}`;
    return (0, ethers_1.isAddress)(address) ? (0, ethers_1.getAddress)(address) : null;
};
const getAbiBytesAtOffset = (data, offset) => {
    if (offset < BigInt(EXEC_TRANSACTION_STATIC_WORDS * 32))
        return null;
    if (offset > BigInt(Number.MAX_SAFE_INTEGER))
        return null;
    const lengthStart = decodeCall_1.CALLDATA_SELECTOR_HEX_LENGTH + Number(offset) * 2;
    const lengthEnd = lengthStart + ABI_WORD_HEX_LENGTH;
    if (data.length < lengthEnd)
        return null;
    let byteLength;
    try {
        byteLength = BigInt(`0x${data.slice(lengthStart, lengthEnd)}`);
    }
    catch {
        return null;
    }
    if (byteLength > BigInt(Number.MAX_SAFE_INTEGER))
        return null;
    const valueStart = lengthEnd;
    const valueEnd = valueStart + Number(byteLength) * 2;
    if (data.length < valueEnd)
        return null;
    return `0x${data.slice(valueStart, valueEnd)}`;
};
const getSafeTxCallsFromExecTransactionHead = (call) => {
    if (!call.data || !(0, ethers_1.isHexString)(call.data))
        return null;
    const selector = call.data.slice(0, decodeCall_1.CALLDATA_SELECTOR_HEX_LENGTH).toLowerCase();
    if (selector !== safeExecTransactionSelector) {
        return null;
    }
    const to = getAbiWordAsAddress(call.data, 0);
    const value = getAbiWordAsBigInt(call.data, 1);
    const dataOffset = getAbiWordAsBigInt(call.data, 2);
    const operation = getAbiWordAsBigInt(call.data, 3);
    if (!to || value === null || dataOffset === null || operation === null)
        return null;
    const data = getAbiBytesAtOffset(call.data, dataOffset);
    if (data === null)
        return null;
    if (operation === 0n)
        return [{ to, data, value }];
    if (operation !== 1n)
        return null;
    try {
        const multiSendDecoded = calldata_1.multiSendInterface.decodeFunctionData('multiSend', (0, calldata_1.getAbiBytesCalldataWithPadding)(data));
        const transactionsHex = multiSendDecoded[0];
        if (typeof transactionsHex !== 'string')
            return null;
        return (0, helpers_1.decodeMultiSend)(transactionsHex)
            .filter((transaction) => transaction.success)
            .map((transaction) => ({
            to: transaction.to,
            data: transaction.data,
            value: transaction.value
        }));
    }
    catch {
        return null;
    }
};
const getSafeTxCallsFromExecTransactionCall = (call) => {
    if (!call.data || !(0, ethers_1.isHexString)(call.data))
        return null;
    try {
        const decoded = safeExecTransactionInterface.decodeFunctionData('execTransaction', call.data);
        const [to, value, data, operation] = decoded;
        if (typeof to !== 'string' || !(0, ethers_1.isAddress)(to))
            return null;
        if (typeof data !== 'string' || !(0, ethers_1.isHexString)(data))
            return null;
        const bigintValue = BigInt(value);
        const bigintOperation = BigInt(operation);
        if (bigintOperation === 0n) {
            return [
                {
                    to,
                    data,
                    value: bigintValue
                }
            ];
        }
        if (bigintOperation !== 1n)
            return null;
        const multiSendDecoded = calldata_1.multiSendInterface.decodeFunctionData('multiSend', (0, calldata_1.getAbiBytesCalldataWithPadding)(data));
        const transactionsHex = multiSendDecoded[0];
        if (typeof transactionsHex !== 'string')
            return null;
        return (0, helpers_1.decodeMultiSend)(transactionsHex)
            .filter((transaction) => transaction.success)
            .map((transaction) => ({
            to: transaction.to,
            data: transaction.data,
            value: transaction.value
        }));
    }
    catch {
        return getSafeTxCallsFromExecTransactionHead(call);
    }
};
const getAddressFromStorageSlot = (slotValue) => {
    if (!(0, ethers_1.isHexString)(slotValue) || slotValue.length !== 66)
        return null;
    const address = (0, ethers_1.getAddress)(`0x${slotValue.slice(-40)}`);
    return address.toLowerCase() === ethers_1.ZeroAddress ? null : address;
};
exports.getAddressFromStorageSlot = getAddressFromStorageSlot;
/**
 * Picks the index entry matching a typed message. Entries without `encodeTypeHashes` match
 * anything; otherwise the message's own hash has to be among them. A message whose hash could not
 * be computed falls back to the sole entry, when there is exactly one.
 */
const selectEip712IndexEntry = (entries, encodeTypeHash) => {
    if (!encodeTypeHash)
        return entries.length === 1 ? entries[0] : null;
    return (entries.find((entry) => !entry.encodeTypeHashes?.length ||
        entry.encodeTypeHashes.some((hash) => hash.toLowerCase() === encodeTypeHash)) || null);
};
exports.selectEip712IndexEntry = selectEip712IndexEntry;
const getEip712Key = (chainId, verifyingContract, primaryType) => `${(0, utils_1.getRegistryKey)(chainId, verifyingContract)}:${primaryType}`;
/**
 * Merges a descriptor with everything its `includes` point at, collecting a want for any include
 * not yet fetched. Returns null while anything is still missing, so the caller reports its wants
 * and is asked again next round.
 */
const mergeIncludes = (path, known, wants, depth = 0) => {
    const descriptor = known.descriptorsByPath[path];
    // undefined means not asked for yet; null means asked for and unavailable, so stop asking
    if (descriptor === undefined) {
        wants.push({ kind: 'includedDescriptor', path });
        return null;
    }
    if (!descriptor)
        return null;
    const includes = descriptor.includes
        ? Array.isArray(descriptor.includes)
            ? descriptor.includes
            : [descriptor.includes]
        : [];
    if (!includes.length || depth >= exports.ERC7730_MAX_RESOLUTION_DEPTH)
        return descriptor;
    const included = includes.map((includePath) => mergeIncludes(getIncludePath(includePath, path), known, wants, depth + 1));
    if (included.some((one) => !one))
        return null;
    const mergedIncludes = included.reduce((merged, one) => mergeDescriptors(merged, one), {});
    return mergeDescriptors(mergedIncludes, descriptor);
};
/**
 * The descriptor registered for a contract, following a Safe-style proxy to its singleton when the
 * address itself has none. Collects wants for whatever is still missing.
 */
const resolveRegisteredDescriptor = (chainId, address, known, wants, followProxy) => {
    const registryKey = (0, utils_1.getRegistryKey)(chainId, address);
    const registered = known.contractDescriptors[registryKey];
    if (registered === undefined) {
        wants.push({ kind: 'contractDescriptor', chainId, address });
        return null;
    }
    if (registered) {
        const descriptor = mergeIncludes(registered.path, known, wants);
        return descriptor ? { descriptor, path: registered.path } : null;
    }
    // Nothing registered for the address itself - it may be a proxy whose singleton has a descriptor
    if (!followProxy)
        return null;
    const singletonKey = (0, utils_1.getSafeSingletonKey)(chainId, address);
    const singleton = known.safeSingletons[singletonKey];
    if (singleton === undefined) {
        wants.push({ kind: 'safeSingleton', chainId, address });
        return null;
    }
    if (!singleton || singleton.toLowerCase() === address.toLowerCase())
        return null;
    return resolveRegisteredDescriptor(chainId, singleton, known, wants, false);
};
const hasCalldataFieldCache = new WeakMap();
const fieldsContainCalldataFormat = (fields) => !!fields?.some((field) => field.format === 'calldata' || fieldsContainCalldataFormat(field.fields));
/**
 * Whether the descriptor describes a call that carries other calls inside it. Formatting a call is
 * the only way to find those, and it is far too expensive to do for every call, so this decides up
 * front whether it is worth doing at all.
 */
const hasCalldataField = (descriptor) => {
    const cached = hasCalldataFieldCache.get(descriptor);
    if (cached !== undefined)
        return cached;
    const formats = Object.values(descriptor.display?.formats || {});
    const definitions = Object.values(descriptor.display?.definitions || {});
    const result = formats.some((format) => fieldsContainCalldataFormat(format.fields)) ||
        fieldsContainCalldataFormat(definitions);
    hasCalldataFieldCache.set(descriptor, result);
    return result;
};
/**
 * The descriptor of every call embedded in `call` through a `format: 'calldata'` field, keyed by
 * `eip155:{chainId}:{address}`.
 *
 * The embedded calls are found by formatting the call in collect mode - the same code that will
 * later render them - so this can never ask for a descriptor the humanizer does not use, or miss
 * one it does. Each round feeds the descriptors found so far back in, because an embedded call read
 * through its own descriptor can reveal calls embedded deeper still.
 */
const resolveNestedCalldataDescriptors = (call, chainId, resolvedDescriptor, known, wants, accountAddr) => {
    if (!hasCalldataField(resolvedDescriptor.descriptor))
        return undefined;
    const nestedCallDescriptors = {};
    for (let round = 0; round < exports.ERC7730_MAX_RESOLUTION_DEPTH; round++) {
        const collectedNestedCalls = [];
        (0, humanize_1.humanizeCallWithErc7730)(call, chainId, accountAddr, { ...resolvedDescriptor, nestedCallDescriptors }, undefined, collectedNestedCalls);
        let didResolveNewDescriptor = false;
        collectedNestedCalls.forEach((nestedCall) => {
            if (!nestedCall.to || !(0, ethers_1.isAddress)(nestedCall.to))
                return;
            const registryKey = (0, utils_1.getRegistryKey)(chainId, nestedCall.to);
            if (nestedCallDescriptors[registryKey])
                return;
            // A proxy lookup costs an RPC read per embedded call, and an embedded call goes to an
            // arbitrary contract, so it is not worth one
            const resolution = resolveErc7730CallWithoutNested(nestedCall, chainId, known, false, {
                accountAddr
            });
            wants.push(...resolution.wants);
            if (resolution.descriptor) {
                nestedCallDescriptors[registryKey] = resolution.descriptor;
                didResolveNewDescriptor = true;
            }
        });
        if (!didResolveNewDescriptor)
            break;
    }
    return Object.keys(nestedCallDescriptors).length ? nestedCallDescriptors : undefined;
};
/**
 * Everything one call needs, decided from `known` and recording what is still missing.
 *
 * This is the single traversal that both `planErc7730Wants` and `resolveErc7730Descriptors` read,
 * so the plan can never ask for something the resolve step does not use, or miss something it does.
 */
const resolveErc7730CallWithoutNested = (call, chainId, known, followProxy, options) => {
    const wants = [];
    if (!call.to || !(0, ethers_1.isAddress)(call.to))
        return { descriptor: null, wants };
    if (isErc20TransferToFeeCollector(call))
        return { descriptor: null, wants };
    const builtInDescriptor = getBuiltInDescriptorForCall(call);
    // A Safe `execTransaction` describes the transactions inside it, not the call itself
    const safeTxCalls = getSafeTxCallsFromExecTransactionCall(call);
    if (safeTxCalls?.length) {
        const singletonKey = (0, utils_1.getSafeSingletonKey)(chainId, call.to);
        const singleton = known.safeSingletons[singletonKey];
        if (singleton === undefined) {
            wants.push({ kind: 'safeSingleton', chainId, address: call.to });
            return { descriptor: builtInDescriptor, wants };
        }
        if (singleton && singleton.toLowerCase() !== call.to.toLowerCase()) {
            const safeDescriptor = resolveRegisteredDescriptor(chainId, singleton, known, wants, false);
            const nested = resolveInnerCalls(safeTxCalls, chainId, known, wants, options, call.to);
            if (safeDescriptor && !wants.length) {
                return {
                    descriptor: { ...safeDescriptor, innerCalls: safeTxCalls, innerCallDescriptors: nested },
                    wants
                };
            }
            return { descriptor: builtInDescriptor, wants };
        }
    }
    const registryDescriptor = resolveRegisteredDescriptor(chainId, call.to, known, wants, 
    // Following a proxy costs an RPC read, so only bother when nothing else describes the call
    followProxy && !builtInDescriptor);
    if (wants.length)
        return { descriptor: builtInDescriptor, wants };
    if (!registryDescriptor)
        return { descriptor: builtInDescriptor, wants };
    if (!builtInDescriptor)
        return { descriptor: registryDescriptor, wants };
    return {
        descriptor: {
            descriptor: applyBuiltInFormatOverrides(mergeDescriptors(builtInDescriptor.descriptor, registryDescriptor.descriptor), builtInDescriptor),
            path: registryDescriptor.path
        },
        wants
    };
};
/**
 * The descriptor for one call, plus the descriptors of every call embedded in it.
 *
 * This is the single traversal that both `planErc7730Wants` and `resolveErc7730Descriptors` read,
 * so the plan can never ask for something the resolve step does not use, or miss something it does.
 */
const resolveErc7730Call = (call, chainId, known, 
/**
 * Whether an address with no descriptor of its own is worth a proxy-singleton lookup. Off for the
 * inner calls of a Safe transaction: they go to arbitrary contracts, and reading a singleton slot
 * off each one is an RPC round trip that almost never finds anything.
 */
followProxy = true, options = {}) => {
    const resolution = resolveErc7730CallWithoutNested(call, chainId, known, followProxy, options);
    const { accountAddr } = options;
    if (!accountAddr || !resolution.descriptor)
        return resolution;
    const nestedCallDescriptors = resolveNestedCalldataDescriptors(call, chainId, resolution.descriptor, known, resolution.wants, accountAddr);
    if (!nestedCallDescriptors)
        return resolution;
    return {
        descriptor: { ...resolution.descriptor, nestedCallDescriptors },
        wants: resolution.wants
    };
};
exports.resolveErc7730Call = resolveErc7730Call;
/**
 * Resolves a list of inner calls, keyed by their index within the parent.
 *
 * Only a call back to `safeAddress` itself is worth a proxy-singleton lookup - that is the Safe,
 * whose descriptor lives on its singleton. The rest go to arbitrary contracts.
 */
const resolveInnerCalls = (calls, chainId, known, wants, options, safeAddress) => {
    const resolved = {};
    calls.forEach((call, index) => {
        const isSafeItself = !!safeAddress && !!call.to && call.to.toLowerCase() === safeAddress.toLowerCase();
        const resolution = (0, exports.resolveErc7730Call)(call, chainId, known, isSafeItself, options);
        wants.push(...resolution.wants);
        if (resolution.descriptor)
            resolved[index] = resolution.descriptor;
    });
    return resolved;
};
/** What the controller still has to fetch before an accountOp can be fully described. */
const planErc7730Wants = (accountOp, known) => accountOp.calls.flatMap((call) => (0, exports.resolveErc7730Call)(call, accountOp.chainId, known, true, {
    accountAddr: accountOp.accountAddr
}).wants);
exports.planErc7730Wants = planErc7730Wants;
/** The descriptor for each call that has one, given everything fetched so far. */
const resolveErc7730Descriptors = (accountOp, known) => {
    const descriptors = {};
    accountOp.calls.forEach((call, index) => {
        const { descriptor } = (0, exports.resolveErc7730Call)(call, accountOp.chainId, known, true, {
            accountAddr: accountOp.accountAddr
        });
        if (descriptor)
            descriptors[index] = descriptor;
    });
    return descriptors;
};
exports.resolveErc7730Descriptors = resolveErc7730Descriptors;
/** Everything one typed message needs, in the same plan/resolve shape as a call. */
const resolveErc7730Message = (message, known) => {
    const wants = [];
    if (message.content.kind !== 'typedMessage')
        return { descriptor: null, wants };
    const verifyingContract = message.content.domain.verifyingContract;
    const chainId = getTypedMessageChainId(message);
    if (!verifyingContract || !chainId || !(0, ethers_1.isAddress)(verifyingContract)) {
        return { descriptor: null, wants };
    }
    const primaryType = String(message.content.primaryType);
    const builtInDescriptor = getBuiltInDescriptorForMessage(message);
    let encodeTypeHash = null;
    try {
        encodeTypeHash = (0, eip712_1.getEip712EncodeTypeHash)(message.content.types, primaryType);
    }
    catch {
        encodeTypeHash = null;
    }
    const resolveFor = (contract) => {
        const key = getEip712Key(chainId, contract, primaryType);
        const registered = known.eip712Descriptors[key];
        if (registered === undefined) {
            wants.push({
                kind: 'eip712Descriptor',
                chainId,
                verifyingContract: contract,
                primaryType,
                encodeTypeHash
            });
            return null;
        }
        if (!registered)
            return null;
        const descriptor = mergeIncludes(registered.path, known, wants);
        return descriptor ? { descriptor, path: registered.path } : null;
    };
    let descriptor = resolveFor(verifyingContract);
    // A Safe message is signed against the proxy, but described by its singleton
    if (!descriptor && !wants.length && primaryType === consts_1.SAFE_TX_PRIMARY_TYPE) {
        const singletonKey = (0, utils_1.getSafeSingletonKey)(chainId, verifyingContract);
        const singleton = known.safeSingletons[singletonKey];
        if (singleton === undefined) {
            wants.push({ kind: 'safeSingleton', chainId, address: verifyingContract });
            return { descriptor: null, wants };
        }
        if (!singleton || singleton.toLowerCase() === verifyingContract.toLowerCase()) {
            return { descriptor: null, wants };
        }
        descriptor = resolveFor(singleton);
    }
    if (wants.length)
        return { descriptor: builtInDescriptor, wants };
    if (!descriptor)
        return { descriptor: builtInDescriptor, wants };
    // The transactions a SafeTx authorises are described by their own descriptors
    const safeTxCalls = (0, utils_1.getSafeTxCallsFromMessage)(message);
    if (!safeTxCalls?.length)
        return { descriptor, wants };
    const nested = resolveInnerCalls(safeTxCalls, chainId, known, wants, { accountAddr: message.accountAddr }, verifyingContract);
    if (wants.length)
        return { descriptor, wants };
    if (!Object.keys(nested).length)
        return { descriptor, wants };
    return { descriptor: { ...descriptor, innerCallDescriptors: nested }, wants };
};
exports.resolveErc7730Message = resolveErc7730Message;
const planErc7730MessageWants = (message, known) => (0, exports.resolveErc7730Message)(message, known).wants;
exports.planErc7730MessageWants = planErc7730MessageWants;
const resolveErc7730MessageDescriptor = (message, known) => (0, exports.resolveErc7730Message)(message, known).descriptor;
exports.resolveErc7730MessageDescriptor = resolveErc7730MessageDescriptor;
//# sourceMappingURL=registry.js.map