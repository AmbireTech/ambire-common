"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSafeTxGasRefund = exports.humanizeMessageWithErc7730 = exports.humanizeCallWithErc7730 = void 0;
const ethers_1 = require("ethers");
const generalAdapter_1 = require("../modules/Bundler3/generalAdapter");
const safe_1 = require("../../../consts/safe");
const callModules_1 = require("../callModules");
const Allowance_1 = require("../modules/Allowance");
const Safe_1 = require("../modules/Safe");
const utils_1 = require("../utils");
const consts_1 = require("./consts");
const eip712_1 = require("./eip712");
const utils_2 = require("./utils");
const safeTxGasRefund_1 = require("./safeTxGasRefund");
const MAX_INTERPOLATED_VALUE_LENGTH = 80;
const ABI_WORD_HEX_LENGTH = 64;
const safeExecTransactionInterface = new ethers_1.Interface(safe_1.execTransactionAbi);
const isMapReference = (value) => (0, utils_2.isPlainObject)(value) && typeof value.map === 'string' && typeof value.keyPath === 'string';
const toBigIntOrNull = (value) => {
    if (typeof value === 'bigint')
        return value;
    if (typeof value === 'number' || typeof value === 'string') {
        try {
            return BigInt(value);
        }
        catch {
            return null;
        }
    }
    return null;
};
const normalizeComparableValue = (value) => {
    if (typeof value === 'bigint')
        return value.toString();
    if (typeof value === 'string')
        return value.toLowerCase();
    // @ts-ignore
    if (typeof value === 'number' || typeof value === 'boolean' || value === null)
        return value;
    return String(value);
};
const matchesPrimitive = (left, right) => normalizeComparableValue(left) === normalizeComparableValue(right);
const getVisibility = (rule, value) => {
    if (!rule || rule === 'always' || rule === 'optional')
        return { visible: true, valid: true };
    if (rule === 'never')
        return { visible: false, valid: true };
    if (rule.mustBe) {
        return {
            visible: false,
            valid: rule.mustBe.some((expectedValue) => matchesPrimitive(value, expectedValue))
        };
    }
    if (rule.ifNotIn) {
        return {
            visible: !rule.ifNotIn.some((hiddenValue) => matchesPrimitive(value, hiddenValue)),
            valid: true
        };
    }
    return { visible: true, valid: true };
};
const getPathSegments = (path) => {
    const normalizedPath = path.startsWith('.') ? path.slice(1) : path;
    return normalizedPath.split('.').filter(Boolean);
};
const normalizeSegmentIndex = (index, length) => index < 0 ? length + index : index;
const bigintToAbiWordHex = (value) => {
    if (value < 0n)
        return null;
    const hex = value.toString(16);
    if (hex.length > ABI_WORD_HEX_LENGTH)
        return null;
    return hex.padStart(ABI_WORD_HEX_LENGTH, '0');
};
const readBracketSegment = (source, segment) => {
    if (!segment.startsWith('[') || !segment.endsWith(']'))
        return undefined;
    const bracketContent = segment.slice(1, -1);
    const separatorIndex = bracketContent.indexOf(':');
    if (separatorIndex === -1) {
        const index = (0, utils_2.parseIntegerLiteral)(bracketContent);
        if (!Array.isArray(source) || index === null)
            return undefined;
        return source[normalizeSegmentIndex(index, source.length)];
    }
    if (separatorIndex === bracketContent.lastIndexOf(':')) {
        const hex = typeof source === 'string'
            ? source.startsWith('0x')
                ? source.slice(2)
                : source
            : typeof source === 'bigint'
                ? bigintToAbiWordHex(source)
                : null;
        if (hex === null)
            return undefined;
        if (hex.length % 2 !== 0)
            return undefined;
        const startText = bracketContent.slice(0, separatorIndex);
        const endText = bracketContent.slice(separatorIndex + 1);
        const byteLength = hex.length / 2;
        const start = startText === ''
            ? 0
            : normalizeSegmentIndex((0, utils_2.parseIntegerLiteral)(startText) ?? NaN, byteLength);
        const end = endText === ''
            ? byteLength
            : normalizeSegmentIndex((0, utils_2.parseIntegerLiteral)(endText) ?? NaN, byteLength);
        if (!Number.isInteger(start) ||
            !Number.isInteger(end) ||
            start < 0 ||
            end < start ||
            end > byteLength)
            return undefined;
        return `0x${hex.slice(start * 2, end * 2)}`;
    }
    return undefined;
};
const readPath = (source, path) => {
    if (!path)
        return source;
    return getPathSegments(path).reduce((currentValue, segment) => {
        if (currentValue === undefined || currentValue === null)
            return undefined;
        const bracketValue = readBracketSegment(currentValue, segment);
        if (bracketValue !== undefined)
            return bracketValue;
        if (segment === '[]')
            return Array.isArray(currentValue) ? currentValue : undefined;
        if (segment.endsWith('[]')) {
            const key = segment.slice(0, -2);
            const value = (0, utils_2.isPlainObject)(currentValue) ? currentValue[key] : undefined;
            return Array.isArray(value) ? value : undefined;
        }
        if (Array.isArray(currentValue)) {
            const index = Number(segment);
            if (Number.isInteger(index))
                return currentValue[index];
            return currentValue.map((item) => ((0, utils_2.isPlainObject)(item) ? item[segment] : undefined));
        }
        return (0, utils_2.isPlainObject)(currentValue) ? currentValue[segment] : undefined;
    }, source);
};
const resolvePath = (path, context, base) => {
    if (!path)
        return undefined;
    if (path === '#')
        return context.root;
    if (path.startsWith('#.'))
        return readPath(context.root, path.slice(2));
    if (path === '@')
        return context.root['@'];
    if (path.startsWith('@.'))
        return readPath(context.root['@'], path.slice(2));
    if (path === '$')
        return context.descriptor;
    if (path.startsWith('$.'))
        return readPath(context.descriptor, path.slice(2));
    const valueFromBase = readPath(base, path);
    if (valueFromBase !== undefined)
        return valueFromBase;
    return readPath(context.root, path);
};
const resolveMapReference = (reference, context, base) => {
    const map = resolvePath(reference.map, context, base);
    const key = resolvePath(reference.keyPath, context, base);
    if (!(0, utils_2.isPlainObject)(map) || key === undefined || key === null)
        return undefined;
    return map[String(key)];
};
const resolveParamValue = (value, context, base, treatStringAsPath = false) => {
    if (isMapReference(value))
        return resolveMapReference(value, context, base);
    if (typeof value === 'string' &&
        (treatStringAsPath ||
            value === '#' ||
            value === '$' ||
            value === '@' ||
            value.startsWith('#.') ||
            value.startsWith('$.') ||
            value.startsWith('@.')))
        return resolvePath(value, context, base);
    return value;
};
const valueToText = (value) => {
    if (typeof value === 'bigint')
        return value.toString();
    if (typeof value === 'string') {
        if (value.startsWith('0x') && value.length > MAX_INTERPOLATED_VALUE_LENGTH) {
            return `${value.slice(0, 18)}...${value.slice(-8)}`;
        }
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return value.map(valueToText).join(', ');
    try {
        return JSON.stringify(value, (_, nestedValue) => typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue);
    }
    catch {
        return String(value);
    }
};
const normalizeDecodedParam = (value, param) => {
    if (param.baseType === 'array' && param.arrayChildren) {
        return Array.from(value).map((item) => normalizeDecodedParam(item, param.arrayChildren));
    }
    if (param.baseType === 'tuple') {
        const components = param.components || [];
        return components.reduce((acc, component, index) => {
            if (component.name) {
                acc[component.name] = normalizeDecodedParam(value[index], component);
            }
            return acc;
        }, {});
    }
    return value;
};
const decodedArgsToObject = (decodedArgs, inputs) => inputs.reduce((acc, input, index) => {
    const value = normalizeDecodedParam(decodedArgs[index], input);
    acc[index.toString()] = value;
    if (input.name)
        acc[input.name] = value;
    return acc;
}, {});
const getFunctionFragment = (signature) => {
    try {
        const iface = new ethers_1.Interface([`function ${signature}`]);
        const fragment = iface.fragments[0];
        return fragment?.type === 'function' ? fragment : null;
    }
    catch {
        return null;
    }
};
const getCalldataFormatMatch = (call, descriptor) => {
    if (!call.data || call.data.length < 10)
        return null;
    const formats = descriptor.display?.formats || {};
    const selector = call.data.slice(0, 10).toLowerCase();
    for (const [formatKey, format] of Object.entries(formats)) {
        const fragment = getFunctionFragment(formatKey);
        if (!fragment || fragment.selector.toLowerCase() !== selector)
            continue;
        try {
            const iface = new ethers_1.Interface([`function ${formatKey}`]);
            const decodedArgs = iface.decodeFunctionData(fragment, call.data);
            return {
                formatKey,
                format,
                values: decodedArgsToObject(decodedArgs, fragment.inputs)
            };
        }
        catch {
            continue;
        }
    }
    return null;
};
const getSafeExecTransactionWarnings = (match) => {
    const fragment = getFunctionFragment(match.formatKey);
    if (fragment?.name !== 'execTransaction')
        return [];
    const operation = toBigIntOrNull(match.values.operation);
    const to = match.values.to;
    if (operation === null || typeof to !== 'string')
        return [];
    return (0, Safe_1.getDelegateCallWarning)(operation, to);
};
// `getCalldataFormatMatch` already ABI-decodes every execTransaction argument regardless of which
// ones the resolved descriptor's own fields declare, so baseGas/gasPrice/gasToken/refundReceiver
// are available here the same way they are for a SafeTx message - see buildSafeTxGasRefund.
const getSafeExecTransactionGasRefund = (match) => {
    const fragment = getFunctionFragment(match.formatKey);
    if (fragment?.name !== 'execTransaction')
        return null;
    return (0, safeTxGasRefund_1.buildSafeTxGasRefund)(match.values.baseGas, match.values.gasPrice, match.values.gasToken, match.values.refundReceiver);
};
const getTypedMessageFormatMatch = (message, descriptor) => {
    if (message.content.kind !== 'typedMessage')
        return null;
    const formats = descriptor.display?.formats || {};
    const primaryType = String(message.content.primaryType);
    let encodeType = null;
    let encodeTypeHash = null;
    try {
        encodeType = (0, eip712_1.getEip712EncodeType)(message.content.types, primaryType);
        encodeTypeHash = (0, eip712_1.getEip712EncodeTypeHashFromString)(encodeType);
    }
    catch {
        encodeType = null;
    }
    const entry = Object.entries(formats).find(([formatKey]) => {
        if (encodeType && formatKey === encodeType)
            return true;
        if (!formatKey.startsWith(`${primaryType}(`))
            return false;
        if (!encodeTypeHash)
            return true;
        return (0, eip712_1.getEip712EncodeTypeHashFromString)(formatKey) === encodeTypeHash;
    });
    if (!entry)
        return null;
    return {
        formatKey: entry[0],
        format: entry[1],
        values: message.content.message
    };
};
const formatDate = (value, field) => {
    if (field.params?.encoding === 'blockheight')
        return `Block ${valueToText(value)}`;
    const timestamp = toBigIntOrNull(value);
    if (timestamp === null)
        return valueToText(value);
    if (isNoExpirationValue(timestamp))
        return 'No expiration';
    const date = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(date.getTime()))
        return valueToText(value);
    return date.toLocaleString();
};
const isNoExpirationValue = (value) => {
    if (value === ethers_1.MaxUint256)
        return true;
    const hexValue = value.toString(16);
    return hexValue.length >= 8 && [...hexValue].every((char) => char.toLowerCase() === 'f');
};
const formatDuration = (value) => {
    const duration = toBigIntOrNull(value);
    if (duration === null)
        return valueToText(value);
    const hours = duration / 3600n;
    const minutes = (duration % 3600n) / 60n;
    const seconds = duration % 60n;
    return [hours, minutes, seconds].map((part) => part.toString().padStart(2, '0')).join(':');
};
const formatUnitValue = (value, field) => {
    const amount = toBigIntOrNull(value);
    const base = typeof field.params?.base === 'string' ? field.params.base : '';
    const decimals = typeof field.params?.decimals === 'number' ? field.params.decimals : 0;
    if (amount === null)
        return `${valueToText(value)}${base ? ` ${base}` : ''}`;
    return `${(0, ethers_1.formatUnits)(amount, decimals)}${base ? ` ${base}` : ''}`;
};
const getChainIdFromField = (field, context, base) => {
    const paramChainId = resolveParamValue(field.params?.chainId, context, base);
    const chainIdPath = typeof field.params?.chainIdPath === 'string'
        ? resolvePath(field.params.chainIdPath, context, base)
        : undefined;
    const chainId = toBigIntOrNull(chainIdPath ?? paramChainId);
    return chainId ?? context.chainId;
};
const isNativeTokenReference = (value) => {
    if (value === undefined || value === null || value === '')
        return true;
    if (typeof value !== 'string' || !(0, ethers_1.isAddress)(value))
        return false;
    return (0, utils_1.eToNative)(value).toLowerCase() === ethers_1.ZeroAddress.toLowerCase();
};
const getNativeCurrencyAddressesFromField = (field, context, base) => {
    const nativeCurrencyAddress = field.params?.nativeCurrencyAddress;
    const values = Array.isArray(nativeCurrencyAddress)
        ? nativeCurrencyAddress
        : [nativeCurrencyAddress];
    return values
        .map((value) => typeof value === 'string' && (0, ethers_1.isAddress)(value)
        ? value
        : resolveParamValue(value, context, base))
        .filter((value) => typeof value === 'string' && (0, ethers_1.isAddress)(value));
};
const getTokenAddressFromField = (field, context, base) => {
    const nativeAddresses = getNativeCurrencyAddressesFromField(field, context, base);
    const hasTokenSource = typeof field.params?.tokenPath === 'string' ||
        field.params?.token !== undefined ||
        nativeAddresses.length > 0;
    const tokenPath = typeof field.params?.tokenPath === 'string'
        ? resolvePath(field.params.tokenPath, context, base)
        : undefined;
    const tokenParam = resolveParamValue(field.params?.token, context, base);
    const tokenAddress = tokenPath ?? tokenParam;
    if (hasTokenSource && isNativeTokenReference(tokenAddress))
        return ethers_1.ZeroAddress;
    if (typeof tokenAddress === 'bigint') {
        const uintAddress = (0, utils_1.uintToAddress)(tokenAddress);
        return nativeAddresses.some((address) => (0, utils_1.eToNative)(address).toLowerCase() === (0, utils_1.eToNative)(uintAddress).toLowerCase())
            ? ethers_1.ZeroAddress
            : (0, utils_1.eToNative)(uintAddress);
    }
    if (typeof tokenAddress !== 'string' || !(0, ethers_1.isAddress)(tokenAddress))
        return null;
    return nativeAddresses.some((address) => (0, utils_1.eToNative)(address).toLowerCase() === (0, utils_1.eToNative)(tokenAddress).toLowerCase())
        ? ethers_1.ZeroAddress
        : (0, utils_1.eToNative)(tokenAddress);
};
const getCollectionAddressFromField = (field, context, base) => {
    const collectionPath = typeof field.params?.collectionPath === 'string'
        ? resolvePath(field.params.collectionPath, context, base)
        : undefined;
    const collectionParam = resolveParamValue(field.params?.collection, context, base);
    const collectionAddress = collectionPath ?? collectionParam;
    return typeof collectionAddress === 'string' && (0, ethers_1.isAddress)(collectionAddress)
        ? collectionAddress
        : null;
};
const getEnumValue = (value, field, context) => {
    const enumRef = field.params?.$ref;
    if (typeof enumRef !== 'string')
        return null;
    const enumDefinition = resolvePath(enumRef, context, context.root);
    if (!(0, utils_2.isPlainObject)(enumDefinition))
        return null;
    const values = (0, utils_2.isPlainObject)(enumDefinition.values) ? enumDefinition.values : enumDefinition;
    const enumKey = typeof value === 'string' && (0, ethers_1.isHexString)(value) ? toBigIntOrNull(value)?.toString() : undefined;
    const enumValue = values[enumKey || valueToText(value)];
    return typeof enumValue === 'string' ? enumValue : null;
};
/** Shown for an encrypted field when its descriptor does not give a `fallbackLabel` */
const DEFAULT_ENCRYPTED_VALUE_LABEL = '[Hidden value]';
const formatFieldValue = (field, value, context, base) => {
    // The value of an encrypted field is a ciphertext handle, not the real value. Formatting it
    // (e.g. as a token amount) would show a meaningless huge number, so show the descriptor's
    // fallback text instead.
    // We do not decrypt the value: each encryption scheme (e.g. FHEVM) needs its own custom
    // code, and no real users have asked for it so far.
    if (field.encryption) {
        return [(0, utils_1.getText)(field.encryption.fallbackLabel || DEFAULT_ENCRYPTED_VALUE_LABEL)];
    }
    if (field.format === 'addressName' || field.format === 'interoperableAddressName') {
        if (typeof value === 'bigint')
            return [(0, utils_1.getAddressVisualization)((0, utils_1.uintToAddress)(value))];
        return typeof value === 'string' && (0, ethers_1.isAddress)(value)
            ? [(0, utils_1.getAddressVisualization)(value)]
            : [(0, utils_1.getText)(valueToText(value))];
    }
    if (field.format === 'tokenAmount') {
        const threshold = toBigIntOrNull(field.params?.threshold);
        const amount = toBigIntOrNull(value);
        if (threshold !== null && amount !== null && amount >= threshold && field.params?.message) {
            return [(0, utils_1.getText)(valueToText(field.params.message))];
        }
        const tokenAddress = getTokenAddressFromField(field, context, base);
        if (amount !== null && tokenAddress) {
            return [(0, utils_1.getToken)(tokenAddress, amount, getChainIdFromField(field, context, base))];
        }
    }
    if (field.format === 'amount') {
        const amount = toBigIntOrNull(value);
        const tokenAddress = getTokenAddressFromField(field, context, base) || ethers_1.ZeroAddress;
        if (amount !== null) {
            return [(0, utils_1.getToken)(tokenAddress, amount, getChainIdFromField(field, context, base))];
        }
    }
    if (field.format === 'nftName') {
        const tokenId = toBigIntOrNull(value);
        const collectionAddress = getCollectionAddressFromField(field, context, base);
        if (tokenId !== null && collectionAddress) {
            return [(0, utils_1.getToken)(collectionAddress, tokenId, getChainIdFromField(field, context, base))];
        }
    }
    if (field.format === 'chainId') {
        const chainId = toBigIntOrNull(value);
        return chainId !== null ? [(0, utils_1.getChain)(chainId)] : [(0, utils_1.getText)(valueToText(value))];
    }
    if (field.format === 'date')
        return [(0, utils_1.getText)(formatDate(value, field))];
    if (field.format === 'duration')
        return [(0, utils_1.getText)(formatDuration(value))];
    if (field.format === 'unit')
        return [(0, utils_1.getText)(formatUnitValue(value, field))];
    if (field.format === 'enum')
        return [(0, utils_1.getText)(getEnumValue(value, field, context) || valueToText(value))];
    if (typeof value === 'string' && (0, ethers_1.isAddress)(value))
        return [(0, utils_1.getAddressVisualization)(value)];
    return [(0, utils_1.getText)(valueToText(value))];
};
// A field value is usually a literal, but ERC-7730 also allows it to be a descriptor
// path pointing at a constant authored in the file itself (e.g. the vault ticker in
// `$.metadata.constants.vaultTicker`), which has to be resolved before it is displayed
const getFieldValue = (field, context, base) => {
    if (field.value === undefined)
        return resolvePath(field.path, context, base);
    return typeof field.value === 'string' && (field.value === '$' || field.value.startsWith('$.'))
        ? resolvePath(field.value, context, base)
        : field.value;
};
const getArrayValueAt = (value, index) => Array.isArray(value) ? value[index] : value;
/**
 * A Morpho general adapter carries the action it performs in its own calldata and has no ERC-7730
 * descriptor of its own, so nothing above this can describe it. Tried only after the embedded call
 * failed to find a descriptor, so a descriptor always wins over this.
 */
const getGeneralAdapterCalldataValue = (context, calldata, callee, amount) => {
    if (typeof calldata !== 'string' || !calldata.startsWith('0x'))
        return null;
    if (typeof callee !== 'string' || !(0, ethers_1.isAddress)(callee))
        return null;
    const accountAddr = resolvePath('#.@.accountAddr', context, context.root);
    if (typeof accountAddr !== 'string' || !(0, ethers_1.isAddress)(accountAddr))
        return null;
    const decodedCall = (0, generalAdapter_1.decodeGeneralAdapterCall)(accountAddr, {
        to: callee,
        data: calldata,
        value: toBigIntOrNull(amount) || 0n
    });
    const decodedValue = decodedCall.fullVisualization?.filter((item) => item.type !== 'break');
    return decodedValue?.length ? decodedValue : null;
};
const getNestedErc7730CalldataValue = (context, calldata, callee, amount) => {
    // No depth limit here on purpose: every nested calldata is a part of its parent
    // calldata, so it is always shorter and the recursion always stops. A depth limit
    // in the library hides the warnings of the deeply embedded calls. The limit for how
    // deep the nested calls are shown is applied in the UI.
    if (typeof calldata !== 'string' || !calldata.startsWith('0x') || calldata.length < 10)
        return null;
    if (typeof callee !== 'string' || !(0, ethers_1.isAddress)(callee))
        return null;
    if (!context.chainId)
        return null;
    // A descriptor that points at the calldata of its own call would recurse forever
    const parentCalldata = resolvePath('#.@.data', context, context.root);
    if (typeof parentCalldata === 'string' && parentCalldata === calldata)
        return null;
    const accountAddr = resolvePath('#.@.accountAddr', context, context.root);
    if (typeof accountAddr !== 'string' || !(0, ethers_1.isAddress)(accountAddr))
        return null;
    const nestedCall = {
        to: callee,
        data: calldata,
        value: toBigIntOrNull(amount) || 0n
    };
    context.collectedNestedCalls?.push(nestedCall);
    // The descriptor of the contract the embedded call actually goes to, fetched for it by the
    // registry. The descriptor of the call that carries it stands in only when both go to the same
    // contract, which is the one case where it describes the embedded call too. For any other
    // contract the embedded call is left to the plain humanizer modules further down, rather than
    // described by a format of an unrelated contract that happens to share a selector.
    const parentCallee = resolvePath('#.@.to', context, context.root);
    const isSameContract = typeof parentCallee === 'string' && parentCallee.toLowerCase() === callee.toLowerCase();
    const nestedDescriptor = context.nestedCallDescriptors?.[(0, utils_2.getRegistryKey)(context.chainId, callee)] ||
        (isSameContract ? { descriptor: context.descriptor, path: context.descriptorPath } : null);
    if (!nestedDescriptor)
        return null;
    const humanizedCall = (0, exports.humanizeCallWithErc7730)(nestedCall, context.chainId, accountAddr, { ...nestedDescriptor, nestedCallDescriptors: context.nestedCallDescriptors }, undefined, context.collectedNestedCalls);
    const erc7730Visualization = humanizedCall?.fullVisualization?.find((visualization) => visualization.type === 'erc7730');
    if (erc7730Visualization?.type !== 'erc7730')
        return null;
    context.collectedWarnings.push(...(humanizedCall?.warnings || []));
    return erc7730Visualization;
};
const resolveCalldataParam = (field, context, base, pathKey, valueKey) => {
    const pathParam = field.params?.[pathKey];
    if (typeof pathParam === 'string')
        return resolvePath(pathParam, context, base);
    return resolveParamValue(field.params?.[valueKey], context, base, true);
};
const getCalldataRows = (field, value, context, base) => {
    const values = Array.isArray(value) ? value : [value];
    const calleeValues = resolveCalldataParam(field, context, base, 'calleePath', 'callee');
    const selectorValues = resolveCalldataParam(field, context, base, 'selectorPath', 'selector');
    const amountValues = resolveCalldataParam(field, context, base, 'amountPath', 'amount');
    const accountAddr = resolvePath('#.@.accountAddr', context, context.root);
    return values.reduce((acc, calldata, index) => {
        if (!acc)
            return null;
        const rowValue = [];
        const callee = getArrayValueAt(calleeValues, index);
        const selector = getArrayValueAt(selectorValues, index);
        const amount = getArrayValueAt(amountValues, index);
        const nestedVisualization = getNestedErc7730CalldataValue(context, calldata, callee, amount);
        if (nestedVisualization) {
            acc.push({ type: 'call', value: [nestedVisualization] });
            return acc;
        }
        const generalAdapterValue = getGeneralAdapterCalldataValue(context, calldata, callee, amount);
        if (generalAdapterValue) {
            acc.push({ type: 'call', value: generalAdapterValue });
            return acc;
        }
        if (typeof calldata === 'string' &&
            typeof callee === 'string' &&
            (0, ethers_1.isAddress)(callee) &&
            typeof accountAddr === 'string' &&
            context.chainId) {
            const call = { to: callee, data: calldata, value: toBigIntOrNull(amount) || 0n };
            const moduleFallbackValue = getModuleFallbackValue(call, context.chainId, accountAddr, context.collectedWarnings);
            if (moduleFallbackValue) {
                acc.push({ type: 'call', value: moduleFallbackValue });
                return acc;
            }
        }
        if (typeof callee === 'string' && (0, ethers_1.isAddress)(callee)) {
            rowValue.push((0, utils_1.getAddressVisualization)(callee));
        }
        if (typeof selector === 'string') {
            rowValue.push((0, utils_1.getText)(selector));
        }
        else if (typeof calldata === 'string' && calldata.startsWith('0x') && calldata.length >= 10) {
            rowValue.push((0, utils_1.getText)(calldata.slice(0, 10)));
        }
        else {
            rowValue.push((0, utils_1.getText)(valueToText(calldata)));
        }
        acc.push({ type: 'call', value: rowValue });
        return acc;
    }, []);
};
const isZeroAddressValue = (value) => typeof value === 'string' && (0, ethers_1.isAddress)(value) && value.toLowerCase() === ethers_1.ZeroAddress;
const shouldHideZeroAddressToRow = (field, value) => {
    const label = (field.label || field.path || '').trim().toLowerCase();
    return label === 'to' && isZeroAddressValue(value);
};
const resolveFieldReference = (field, context) => {
    if (!field.$ref)
        return field;
    const referencedField = resolvePath(field.$ref, context, context.root);
    if (!(0, utils_2.isPlainObject)(referencedField))
        return field;
    return {
        ...referencedField,
        ...field,
        $ref: undefined
    };
};
const ARRAY_SEGMENT = '[]';
// Substitutes the array iterator segment (`[]`) in a path with a concrete
// index, e.g. "details.[].amount" + 1 -> "details.1.amount".
const substituteArrayIndex = (path, index) => getPathSegments(path)
    .map((segment) => (segment === ARRAY_SEGMENT ? String(index) : segment))
    .join('.');
// Applies substituteArrayIndex to every string param that itself references
// the same array (e.g. tokenPath, chainIdPath, collectionPath), so a leaf
// field like `details.[].amount` with `params.tokenPath: details.[].token`
// resolves both to the same array item instead of collapsing to arrays.
const substituteArrayIndexInParams = (params, index) => {
    if (!params)
        return params;
    return Object.fromEntries(Object.entries(params).map(([key, value]) => [
        key,
        typeof value === 'string' && value.includes(ARRAY_SEGMENT)
            ? substituteArrayIndex(value, index)
            : value
    ]));
};
const fieldToRows = (field, context, base) => {
    const resolvedField = resolveFieldReference(field, context);
    // A leaf field (no `fields` sub-array) whose own path iterates an array,
    // e.g. "details.[].amount", means "one row per array element" per the
    // ERC-7730 spec. Expand it into one indexed field per item so path/params
    // (e.g. tokenPath) resolve against the same array element instead of each
    // independently collapsing to the whole array.
    if (!resolvedField.fields?.length && resolvedField.path?.includes(ARRAY_SEGMENT)) {
        const arraySegmentEnd = resolvedField.path.indexOf(ARRAY_SEGMENT) + ARRAY_SEGMENT.length;
        const arrayValue = resolvePath(resolvedField.path.slice(0, arraySegmentEnd), context, base);
        if (Array.isArray(arrayValue)) {
            return arrayValue.reduce((acc, _, index) => {
                if (!acc)
                    return null;
                const indexedField = {
                    ...resolvedField,
                    path: substituteArrayIndex(resolvedField.path, index),
                    params: substituteArrayIndexInParams(resolvedField.params, index)
                };
                const rows = fieldToRows(indexedField, context, base);
                if (!rows)
                    return null;
                acc.push(...rows);
                return acc;
            }, []);
        }
    }
    const value = getFieldValue(resolvedField, context, base);
    const visibility = getVisibility(resolvedField.visible, value);
    if (!visibility.valid)
        return null;
    if (!visibility.visible)
        return [];
    if (resolvedField.fields?.length) {
        const groupedValue = value ?? base;
        const groupedValues = Array.isArray(groupedValue) ? groupedValue : [groupedValue];
        return groupedValues.reduce((acc, item) => {
            if (!acc)
                return null;
            const nestedRows = fieldsToRows(resolvedField.fields || [], context, item);
            if (!nestedRows)
                return null;
            acc.push(...nestedRows);
            return acc;
        }, []);
    }
    if (value === undefined)
        return resolvedField.visible === 'optional' ? [] : null;
    if (shouldHideZeroAddressToRow(resolvedField, value))
        return [];
    if (resolvedField.format === 'calldata')
        return getCalldataRows(resolvedField, value, context, base);
    // Every `formatFieldValue` branch renders a field as exactly one visualization, which is what
    // makes a non-`calldata` row a single labelled value.
    const [formattedValue] = formatFieldValue(resolvedField, value, context, base);
    if (!formattedValue)
        return null;
    return [
        {
            type: 'single-value',
            label: resolvedField.label || resolvedField.path || '',
            value: formattedValue,
            path: resolvedField.path ?? ''
        }
    ];
};
const fieldsToRows = (fields, context, base) => {
    return fields.reduce((acc, field) => {
        if (!acc)
            return null;
        const rows = fieldToRows(field, context, base);
        if (!rows)
            return null;
        acc.push(...rows);
        return acc;
    }, []);
};
// Per the ERC-7730 spec's interpolation algorithm, each `{path}` placeholder
// must be resolved against the matching entry in the format's `fields` array
// (by path, after resolving `$ref`) so its declared `format`/`params` control
// how the value is rendered - not just the raw value. Only leaf fields are
// searched: interpolated intents may only reference always-visible paths, and
// those never live under a grouped/array `fields` sub-list.
const findInterpolationField = (fields, path, context) => {
    if (!fields)
        return null;
    for (const field of fields) {
        const resolvedField = resolveFieldReference(field, context);
        if (resolvedField.path === path)
            return resolvedField;
    }
    return null;
};
// Builds the ERC-7730 `interpolatedIntent` title as structured parts. Every
// placeholder uses the same field formatter as its corresponding detail row.
// Interpolation is all-or-nothing: malformed templates, unresolved paths,
// fields that are not always visible, or missing formatters return null so the
// UI can fall back to the static `intent` and its rows. Also returns the field
// paths consumed by a placeholder, so the caller can exclude them from the
// detail rows shown alongside the interpolated intent (they'd otherwise repeat
// the same data twice).
const interpolateIntentParts = (template, fields, context, base) => {
    const parts = [];
    const usedFieldPaths = new Set();
    let currentIndex = 0;
    // The leading word(s) of an interpolated intent are the verb ("Swap ",
    // "Stake ", ...), so render them as an `action` part - same styling as the
    // rest of the app's action verbs (e.g. getAction('Swap') in the Uniswap/
    // CowSwap/etc. modules) - instead of plain text.
    // Literal text is buffered and flushed as one part per contiguous run between
    // placeholders (so an escaped brace stays part of the text around it), trimmed
    // so a part's content is the text itself and nothing else: the spacing the
    // template puts around a placeholder is layout, and the UI renders the parts
    // with a gap between them. Trimming also keeps a part comparable to a plain
    // string (e.g. `intent[0].content === 'Send'`), which a trailing space carried
    // over from the template would otherwise break.
    let textBuffer = '';
    const pushText = (text) => {
        textBuffer += text;
    };
    const flushText = () => {
        const trimmedText = textBuffer.trim();
        textBuffer = '';
        if (!trimmedText)
            return;
        parts.push(parts.length === 0 ? (0, utils_1.getAction)(trimmedText) : (0, utils_1.getText)(trimmedText));
    };
    while (currentIndex < template.length) {
        const openingBraceIndex = template.indexOf('{', currentIndex);
        const closingBraceIndex = template.indexOf('}', currentIndex);
        const nextBraceIndex = openingBraceIndex === -1
            ? closingBraceIndex
            : closingBraceIndex === -1
                ? openingBraceIndex
                : Math.min(openingBraceIndex, closingBraceIndex);
        if (nextBraceIndex === -1) {
            pushText(template.slice(currentIndex));
            break;
        }
        pushText(template.slice(currentIndex, nextBraceIndex));
        const brace = template.charAt(nextBraceIndex);
        const isEscapedBrace = template.charAt(nextBraceIndex + 1) === brace;
        if (isEscapedBrace) {
            pushText(brace);
            currentIndex = nextBraceIndex + 2;
            continue;
        }
        if (brace === '}')
            return null;
        const placeholderEndIndex = template.indexOf('}', nextBraceIndex + 1);
        if (placeholderEndIndex === -1)
            return null;
        const path = template.slice(nextBraceIndex + 1, placeholderEndIndex).trim();
        if (!path || path.includes('{'))
            return null;
        const matchingField = findInterpolationField(fields, path, context);
        if (!matchingField ||
            (matchingField.visible !== undefined && matchingField.visible !== 'always') ||
            matchingField.fields?.length ||
            matchingField.format === 'calldata') {
            return null;
        }
        const value = resolvePath(path, context, base);
        if (value === undefined)
            return null;
        const formattedValue = formatFieldValue(matchingField, value, context, base);
        if (!formattedValue.length)
            return null;
        // An encrypted amount is formatted as its fallback text, never as a token
        if (!matchingField.encryption &&
            (matchingField.format === 'amount' || matchingField.format === 'tokenAmount') &&
            !formattedValue.some((item) => item.type === 'token')) {
            return null;
        }
        if ((matchingField.format === 'addressName' ||
            matchingField.format === 'interoperableAddressName') &&
            !formattedValue.some((item) => item.type === 'address')) {
            return null;
        }
        flushText();
        parts.push(...formattedValue);
        usedFieldPaths.add(path);
        currentIndex = placeholderEndIndex + 1;
    }
    flushText();
    return parts.length ? { parts, usedFieldPaths } : null;
};
const formatToVisualizations = (format, context, dapp) => {
    const interpolation = format.interpolatedIntent
        ? interpolateIntentParts(format.interpolatedIntent, format.fields, context, context.root)
        : null;
    // `format.intent` is the spec's plain, non-interpolated short title (e.g.
    // "Swap") - it needs no token/decimals lookup, so it can never fail the way
    // interpolation can, and is the fallback `intent` (as `[action]`) whenever
    // there's no `interpolatedIntent` or interpolation couldn't be resolved.
    const rows = fieldsToRows(format.fields || [], context, context.root);
    if (!rows)
        return null;
    return [
        (0, utils_1.getErc7730Visualization)(format.intent, rows, dapp, interpolation
            ? { parts: interpolation.parts, usedFieldPaths: [...interpolation.usedFieldPaths] }
            : undefined)
    ];
};
const isOneInchFillOrderFormat = (formatKey, descriptorPath) => !!descriptorPath?.includes('registry/1inch/') && formatKey.startsWith('fillOrder(');
const hasResolvableTokenReference = (field, context) => {
    const resolvedField = resolveFieldReference(field, context);
    const tokenPath = typeof resolvedField.params?.tokenPath === 'string'
        ? resolvePath(resolvedField.params.tokenPath, context, context.root)
        : undefined;
    const token = resolveParamValue(resolvedField.params?.token, context, context.root);
    const tokenReference = tokenPath ?? token;
    return (typeof tokenReference === 'bigint' ||
        (typeof tokenReference === 'string' && (0, ethers_1.isAddress)(tokenReference)));
};
// Applies a structural edit (stripping a row, appending one, replacing one) to `fields` - the only
// stored row array. The displayed rows are derived from `fields` elsewhere, so they stay in sync
// automatically.
const updateErc7730Rows = (visualization, transform) => ({
    ...visualization,
    fields: transform(visualization.fields)
});
const hideOneInchMinimumReceiveWithoutToken = (match, context, fullVisualization) => {
    if (!context.descriptorPath?.includes('registry/1inch/'))
        return fullVisualization;
    const minimumReceiveField = match.format.fields
        ?.map((field) => resolveFieldReference(field, context))
        .find((field) => field.format === 'tokenAmount' &&
        (field.label || field.path || '').trim().toLowerCase() === 'minimum to receive');
    if (!minimumReceiveField || hasResolvableTokenReference(minimumReceiveField, context)) {
        return fullVisualization;
    }
    return fullVisualization.map((visualization) => visualization.type === 'erc7730'
        ? updateErc7730Rows(visualization, (rows) => rows.filter((row) => (0, utils_1.getErc7730RowLabel)(row).trim().toLowerCase() !== 'minimum to receive'))
        : visualization);
};
const getUintAddressValue = (value) => {
    if (typeof value === 'bigint')
        return (0, utils_1.uintToAddress)(value);
    if (typeof value === 'string' && (0, ethers_1.isAddress)(value))
        return value;
    return null;
};
const getOneInchFillOrderSwapVisualization = (match, context, fullVisualization, dapp) => {
    if (!isOneInchFillOrderFormat(match.formatKey, context.descriptorPath))
        return fullVisualization;
    const order = match.values.order;
    if (!(0, utils_2.isPlainObject)(order))
        return fullVisualization;
    const maker = getUintAddressValue(order.maker);
    const makerAsset = getUintAddressValue(order.makerAsset);
    const takerAsset = getUintAddressValue(order.takerAsset);
    const makingAmount = toBigIntOrNull(order.makingAmount);
    const takingAmount = toBigIntOrNull(order.takingAmount);
    if (!maker || !makerAsset || !takerAsset || makingAmount === null || takingAmount === null) {
        return fullVisualization;
    }
    const metadata = context.root['@'];
    const accountAddr = (0, utils_2.isPlainObject)(metadata) ? metadata.accountAddr : undefined;
    const isMakerAccount = typeof accountAddr === 'string' && maker.toLowerCase() === accountAddr.toLowerCase();
    const outgoingToken = isMakerAccount ? makerAsset : takerAsset;
    const outgoingAmount = isMakerAccount ? makingAmount : toBigIntOrNull(match.values.amount);
    const incomingToken = isMakerAccount ? takerAsset : makerAsset;
    const incomingAmount = isMakerAccount ? takingAmount : makingAmount;
    if (outgoingAmount === null)
        return fullVisualization;
    const oneInchVisualization = fullVisualization.find((visualization) => visualization.type === 'erc7730');
    const additionalRows = oneInchVisualization?.fields.filter((row) => !(0, utils_1.getErc7730RowValues)(row).some((value) => value.type === 'token')) || [];
    return [
        (0, utils_1.getErc7730Visualization)(oneInchVisualization?.intent[0]?.content || 'Fill order', [
            {
                type: 'single-value',
                label: 'Amount to Send',
                value: (0, utils_1.getToken)(outgoingToken, outgoingAmount, context.chainId)
            },
            {
                type: 'single-value',
                label: 'Minimum to Receive',
                value: (0, utils_1.getToken)(incomingToken, incomingAmount, context.chainId)
            },
            ...additionalRows
        ], dapp)
    ];
};
// A legacy module describes a call as one flat run of parts, starting with the action verb. That
// run is what a `call` row renders, kept exactly as the module built it - `break`s included, since
// they are where the module wanted the line to end.
const getFlatCallValue = (visualizations) => {
    if (!visualizations?.some((visualization) => visualization.type === 'action'))
        return null;
    return visualizations.length ? visualizations : null;
};
// The flat parts a nested call gets when no ERC-7730 descriptor describes it: the legacy humanizer
// modules run over it and their own wording is handed back untouched, for a `call` row to render.
const getModuleFallbackValue = (call, chainId, accountAddr, collectedWarnings) => {
    const accountOp = {
        accountAddr,
        chainId,
        calls: [call]
    };
    const humanizedCall = (0, callModules_1.humanizeCallWithModules)(accountOp, call);
    const value = getFlatCallValue(humanizedCall?.fullVisualization);
    if (!value)
        return null;
    const resetText = (0, Allowance_1.getSetAllowanceResetText)(call);
    const valueWithReset = resetText && value.some((item) => item.type === 'token')
        ? [...value, (0, utils_1.getText)(resetText, true)]
        : value;
    // The modules above already found everything worth warning about in this nested call, but only
    // its visualization becomes a row. Hand the warnings to the caller so they reach the top level.
    collectedWarnings?.push(...(humanizedCall?.warnings || []));
    return valueWithReset;
};
const hasDisplayedNativeTransactionValue = (fullVisualization, nativeValue) => (0, utils_1.flattenHumanizerVisualizations)(fullVisualization).some((visualization) => visualization.type === 'token' &&
    visualization.address.toLowerCase() === ethers_1.ZeroAddress &&
    visualization.value === nativeValue);
const appendNativeValueRow = (fullVisualization, nativeValue, chainId) => {
    if (nativeValue === 0n)
        return { fullVisualization, didAppendNativeValueRow: false };
    if (hasDisplayedNativeTransactionValue(fullVisualization, nativeValue)) {
        return { fullVisualization, didAppendNativeValueRow: false };
    }
    let didFindErc7730Visualization = false;
    const visualizationWithNativeValue = fullVisualization.map((visualization) => {
        if (didFindErc7730Visualization || visualization.type !== 'erc7730')
            return visualization;
        didFindErc7730Visualization = true;
        return updateErc7730Rows(visualization, (rows) => [
            ...rows,
            {
                type: 'single-value',
                label: 'Send',
                value: (0, utils_1.getToken)(ethers_1.ZeroAddress, nativeValue, chainId)
            }
        ]);
    });
    return {
        fullVisualization: visualizationWithNativeValue,
        didAppendNativeValueRow: didFindErc7730Visualization
    };
};
const getNativeValueWarnings = (didAppendNativeValueRow, nativeAssetSymbol) => {
    if (!nativeAssetSymbol)
        return [];
    return didAppendNativeValueRow
        ? [
            (0, utils_1.getWarning)(`This transaction will send ${nativeAssetSymbol}`, 'ERC7730_REQUIRES_NATIVE_VALUE')
        ]
        : [];
};
// The humanizer decodes all the levels of calls embedded in other calls, but only the
// first MAX_DISPLAYED_NESTED_CALLDATA_DEPTH levels are shown in the UI. A transaction
// nested that deep is unusual, so the user is warned about it.
const getNestedErc7730Depth = (visualization) => {
    const nestedDepths = visualization.fields.flatMap((row) => (0, utils_1.getErc7730RowValues)(row)
        .filter((value) => value.type === 'erc7730')
        .map((nestedVisualization) => 1 + getNestedErc7730Depth(nestedVisualization)));
    return nestedDepths.length ? Math.max(...nestedDepths) : 0;
};
const getNestedCalldataDepthWarnings = (fullVisualization) => {
    const depths = fullVisualization
        .filter((visualization) => visualization.type === 'erc7730')
        .map((visualization) => getNestedErc7730Depth(visualization));
    if (!depths.length || Math.max(...depths) < consts_1.MAX_DISPLAYED_NESTED_CALLDATA_DEPTH)
        return [];
    return [
        (0, utils_1.getWarning)('This transaction hides many other transactions one inside another. This is unusual - continue only if you fully trust this app.', 'ERC7730_SUSPICIOUS_NESTED_CALLDATA_DEPTH')
    ];
};
const getSafeCallWarnings = (call, safeAddr = call.to) => {
    return (0, Safe_1.getSafeHumanization)(safeAddr, call.to, call.value, call.data)?.warnings || [];
};
const getSafeTxGasRefund = (message) => {
    if (message.content.kind !== 'typedMessage')
        return null;
    if (message.content.primaryType !== consts_1.SAFE_TX_PRIMARY_TYPE)
        return null;
    const { baseGas, gasPrice, gasToken, refundReceiver } = message.content.message;
    return (0, safeTxGasRefund_1.buildSafeTxGasRefund)(baseGas, gasPrice, gasToken, refundReceiver);
};
// Same fields as getSafeTxGasRefund, decoded straight from a broadcast execTransaction call's
// calldata instead of a signed SafeTx message.
const getExecTransactionGasRefund = (data) => {
    if (!(0, ethers_1.isHexString)(data))
        return null;
    try {
        const [, , , , , baseGas, gasPrice, gasToken, refundReceiver] = safeExecTransactionInterface.decodeFunctionData('execTransaction', data);
        return (0, safeTxGasRefund_1.buildSafeTxGasRefund)(baseGas, gasPrice, gasToken, refundReceiver);
    }
    catch {
        return null;
    }
};
const getGasRefundWarning = (gasRefund) => gasRefund
    ? [
        (0, utils_1.getWarning)(gasRefund.refundReceiver
            ? 'This transaction also sends a separate payment to the address below as a "gas refund", on top of what is shown above. Only proceed if you expect this'
            : 'This transaction also sends a separate payment to whoever broadcasts it, as a "gas refund", on top of what is shown above. Only proceed if you expect this', 'SAFE{WALLET}_GAS_REFUND', undefined, gasRefund.refundReceiver)
    ]
    : [];
// Always adds a "gas refund" row when the transaction pays one, regardless of whether the
// resolved ERC-7730 descriptor's own fields happen to surface `refundReceiver`/`gasToken`/
// `gasPrice` - this is what actually renders, so it must not depend on what an external
// descriptor declares.
const appendGasRefundRow = (fullVisualization, gasRefund) => {
    if (!gasRefund)
        return fullVisualization;
    // `single-value` rows only ever hold one visualization - this row needs two (who gets it, how
    // much) - so, like every other multi-part row in this file (e.g. SetPreSignature), it's a `call`
    // row with the label folded into its own content instead.
    const refundRow = {
        type: 'call',
        value: [
            (0, utils_1.getLabel)('Gas refund to'),
            gasRefund.refundReceiver
                ? (0, utils_1.getAddressVisualization)(gasRefund.refundReceiver)
                : (0, utils_1.getText)('whoever broadcasts this transaction'),
            gasRefund.minAmount > 0n
                ? (0, utils_1.getToken)(gasRefund.gasToken, gasRefund.minAmount)
                : (0, utils_1.getText)('amount depends on gas used')
        ]
    };
    return fullVisualization.map((visualization) => visualization.type === 'erc7730'
        ? updateErc7730Rows(visualization, (rows) => [...rows, refundRow])
        : visualization);
};
const getSafeTxMessageWarnings = (message) => {
    if (message.content.kind !== 'typedMessage')
        return [];
    if (message.content.primaryType !== consts_1.SAFE_TX_PRIMARY_TYPE)
        return [];
    const warnings = [];
    const { to, operation } = message.content.message;
    const bigintOperation = toBigIntOrNull(operation ?? 0);
    if (bigintOperation !== null && typeof to === 'string') {
        warnings.push(...(0, Safe_1.getDelegateCallWarning)(bigintOperation, to));
    }
    warnings.push(...getGasRefundWarning(getSafeTxGasRefund(message)));
    const safeTxCalls = (0, utils_2.getSafeTxCallsFromMessage)(message) || [];
    safeTxCalls.forEach((safeTxCall) => warnings.push(...getSafeCallWarnings(safeTxCall)));
    return (0, utils_1.dedupeWarnings)(warnings);
};
// One `call` row per call a Safe transaction authorises: the nested visualization when that call
// has an ERC-7730 descriptor of its own, otherwise the flat parts a legacy module produced for it.
//
// `safeAddr` is the Safe executing these inner calls (not necessarily the accountOp/message's own
// `accountAddr` - e.g. an execTransaction can be called on a Safe by an unrelated account). Every
// inner call is humanized as if the Safe itself were the acting account, which is what lets the
// legacy Safe module recognize a self-referential "reject" call as a rejection instead of an
// opaque "Empty call to <address>": `isSafeRejectionCall` matches a call's `to` against the acting
// account, so that account has to be the Safe, not whoever asked the Safe to run it.
const getInnerCallRows = (innerCalls, chainId, safeAddr, resolvedDescriptor, collectedWarnings) => {
    return innerCalls
        .map((innerCall, index) => {
        const innerCallDescriptor = resolvedDescriptor.innerCallDescriptors?.[index];
        if (innerCallDescriptor) {
            const humanizedCall = (0, exports.humanizeCallWithErc7730)(innerCall, chainId, safeAddr, innerCallDescriptor);
            const erc7730Visualization = humanizedCall?.fullVisualization?.find((visualization) => visualization.type === 'erc7730');
            if (erc7730Visualization) {
                collectedWarnings?.push(...(humanizedCall?.warnings || []));
                return [erc7730Visualization];
            }
        }
        // No `modules` argument, so this runs the whole module pipeline, which ends in
        // `fallbackHumanizer` - it describes any call with a `to`, down to "Interacting with", and
        // already reads the known-selector names. Nothing is left for a further fallback to add.
        return getModuleFallbackValue(innerCall, chainId, safeAddr, collectedWarnings);
    })
        .filter((value) => !!value)
        .map((value) => ({ type: 'call', value }));
};
const getSafeTxCallRows = (message, chainId, resolvedDescriptor) => {
    // Covers a plain `call` too - it reads as a batch of exactly one - so there is no separate
    // single-call path to keep in step with this one.
    const safeTxCalls = (0, utils_2.getSafeTxCallsFromMessage)(message);
    if (!safeTxCalls?.length)
        return null;
    // A SafeTx message is signed as/for the Safe itself, so `message.accountAddr` already is the
    // Safe executing these inner calls.
    const innerCallRows = getInnerCallRows(safeTxCalls, chainId, message.accountAddr, resolvedDescriptor);
    return innerCallRows.length ? innerCallRows : null;
};
const replaceSafeTxTransactionRow = (fullVisualization, message, chainId, resolvedDescriptor) => {
    const safeTxCallRows = getSafeTxCallRows(message, chainId, resolvedDescriptor);
    if (!safeTxCallRows)
        return fullVisualization;
    // Computed independently per row list below (not shared), since the placeholder row could in
    // principle be present in one list but not the other.
    const replaceTransactionRow = (rows) => {
        let didReplaceTransactionRow = false;
        const nextRows = rows.flatMap((row) => {
            // `data` is the only `calldata` field a SafeTx format has, so its row is the placeholder the
            // decoded inner calls replace - and any further one is that same undecoded blob again.
            if (row.type !== 'call')
                return [row];
            if (didReplaceTransactionRow)
                return [];
            didReplaceTransactionRow = true;
            return safeTxCallRows;
        });
        return didReplaceTransactionRow ? nextRows : [...nextRows, ...safeTxCallRows];
    };
    return fullVisualization.map((visualization) => visualization.type === 'erc7730'
        ? updateErc7730Rows(visualization, replaceTransactionRow)
        : visualization);
};
const humanizeCallWithErc7730 = (call, chainId, accountAddr, resolvedDescriptor, nativeAssetSymbol, 
/**
 * Set only by the registry, which runs the formatting to find out which calls are embedded in
 * this one so it can fetch a descriptor for each of them.
 */
collectedNestedCalls) => {
    if (resolvedDescriptor.innerCalls?.length) {
        if (!call.to)
            return null;
        // These inner calls are executed by the Safe itself (`call.to`), not by whoever asked it to -
        // see `getInnerCallRows` for why that distinction matters for its "reject" detection.
        const collectedWarnings = [];
        const innerCallRows = getInnerCallRows(resolvedDescriptor.innerCalls, chainId, call.to, resolvedDescriptor, collectedWarnings);
        if (!innerCallRows.length)
            return null;
        const gasRefund = getExecTransactionGasRefund(call.data);
        return {
            ...call,
            fullVisualization: appendGasRefundRow([
                (0, utils_1.getErc7730Visualization)('Execute a Safe{Wallet} Transaction', [
                    {
                        type: 'single-value',
                        label: 'Safe',
                        value: (0, utils_1.getAddressVisualization)(call.to)
                    },
                    ...innerCallRows
                ])
            ], gasRefund),
            warnings: (0, utils_1.dedupeWarnings)([
                ...resolvedDescriptor.innerCalls.flatMap((innerCall) => getSafeCallWarnings(innerCall)),
                ...getGasRefundWarning(gasRefund),
                ...collectedWarnings
            ])
        };
    }
    const match = getCalldataFormatMatch(call, resolvedDescriptor.descriptor);
    if (!match)
        return null;
    const context = {
        descriptor: resolvedDescriptor.descriptor,
        descriptorPath: resolvedDescriptor.path,
        root: {
            ...match.values,
            '@': {
                accountAddr,
                from: accountAddr,
                to: call.to,
                value: call.value,
                data: call.data,
                chainId
            }
        },
        chainId,
        collectedWarnings: [],
        nestedCallDescriptors: resolvedDescriptor.nestedCallDescriptors,
        collectedNestedCalls
    };
    const fullVisualization = formatToVisualizations(match.format, context, call.dapp);
    const normalizedVisualization = fullVisualization
        ? getOneInchFillOrderSwapVisualization(match, context, fullVisualization, call.dapp)
        : null;
    const oneInchVisualization = normalizedVisualization
        ? hideOneInchMinimumReceiveWithoutToken(match, context, normalizedVisualization)
        : null;
    const visualizationWithNativeValue = oneInchVisualization
        ? appendNativeValueRow(oneInchVisualization, call.value, chainId)
        : null;
    if (!visualizationWithNativeValue?.fullVisualization.length)
        return null;
    const gasRefund = getSafeExecTransactionGasRefund(match);
    return {
        ...call,
        fullVisualization: appendGasRefundRow(visualizationWithNativeValue.fullVisualization, gasRefund),
        warnings: (0, utils_1.dedupeWarnings)([
            ...getSafeCallWarnings(call, accountAddr),
            ...getSafeExecTransactionWarnings(match),
            ...getGasRefundWarning(gasRefund),
            ...getNativeValueWarnings(visualizationWithNativeValue.didAppendNativeValueRow, nativeAssetSymbol),
            ...getNestedCalldataDepthWarnings(visualizationWithNativeValue.fullVisualization),
            // warnings the nested calls produced while this call was being formatted
            ...context.collectedWarnings
        ])
    };
};
exports.humanizeCallWithErc7730 = humanizeCallWithErc7730;
const humanizeMessageWithErc7730 = (message, resolvedDescriptor) => {
    const match = getTypedMessageFormatMatch(message, resolvedDescriptor.descriptor);
    if (!match || message.content.kind !== 'typedMessage')
        return null;
    const chainId = toBigIntOrNull(message.content.domain.chainId ?? message.chainId) ?? message.chainId;
    const context = {
        descriptor: resolvedDescriptor.descriptor,
        descriptorPath: resolvedDescriptor.path,
        root: {
            ...match.values,
            '@': {
                accountAddr: message.accountAddr,
                chainId,
                domain: message.content.domain,
                to: message.content.domain.verifyingContract,
                verifyingContract: message.content.domain.verifyingContract
            }
        },
        chainId,
        collectedWarnings: []
    };
    const fullVisualization = formatToVisualizations(match.format, context);
    const safeTxVisualization = fullVisualization && message.content.primaryType === consts_1.SAFE_TX_PRIMARY_TYPE
        ? appendGasRefundRow(replaceSafeTxTransactionRow(fullVisualization, message, chainId, resolvedDescriptor), getSafeTxGasRefund(message))
        : fullVisualization;
    return safeTxVisualization?.length
        ? {
            ...message,
            fullVisualization: safeTxVisualization,
            warnings: (0, utils_1.dedupeWarnings)([
                ...getSafeTxMessageWarnings(message),
                // warnings the calls nested in this message produced while it was being formatted
                ...context.collectedWarnings
            ]),
            canHideDropdownArrow: true
        }
        : null;
};
exports.humanizeMessageWithErc7730 = humanizeMessageWithErc7730;
var safeTxGasRefund_2 = require("./safeTxGasRefund");
Object.defineProperty(exports, "buildSafeTxGasRefund", { enumerable: true, get: function () { return safeTxGasRefund_2.buildSafeTxGasRefund; } });
//# sourceMappingURL=humanize.js.map