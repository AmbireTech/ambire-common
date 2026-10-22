"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.padCallData = exports.eToNative = exports.uintToAddress = exports.EMPTY_HUMANIZER_META = exports.randomId = exports.getUnlimitedApprovalWarning = exports.isUnlimitedAmount = exports.UNLIMITED_APPROVAL_WARNING_CODE = exports.mergeWarnings = exports.dedupeWarnings = void 0;
exports.isHexCall = isHexCall;
exports.getWarning = getWarning;
exports.getLabel = getLabel;
exports.getAction = getAction;
exports.getImage = getImage;
exports.getBreak = getBreak;
exports.getAddressVisualization = getAddressVisualization;
exports.getToken = getToken;
exports.getTokenWithChain = getTokenWithChain;
exports.getChain = getChain;
exports.getText = getText;
exports.getErc7730RowValues = getErc7730RowValues;
exports.getErc7730RowLabel = getErc7730RowLabel;
exports.getErc7730Visualization = getErc7730Visualization;
exports.flattenHumanizerVisualizations = flattenHumanizerVisualizations;
exports.hasErc7730Humanization = hasErc7730Humanization;
exports.getOnBehalfOf = getOnBehalfOf;
exports.getRecipientText = getRecipientText;
exports.getDeadlineText = getDeadlineText;
exports.getDeadline = getDeadline;
exports.getLink = getLink;
exports.getWrapping = getWrapping;
exports.getUnwrapping = getUnwrapping;
exports.getKnownName = getKnownName;
exports.getKnownFunctionName = getKnownFunctionName;
const viem_1 = require("viem");
/** Type guard that narrows an IrCall to one with a valid hex data field. */
function isHexCall(call) {
    return (0, viem_1.isHex)(call.data);
}
function getWarning(content, code, blocking, address) {
    return { content, blocking, code, address };
}
/**
 * Removes repeated warnings, keeping the first of each kind. Warnings for the same call can come
 * from more than one source (a humanizer module and an ERC-7730 descriptor), so the same concern
 * can be reported twice. Two warnings are the same only when their code, text and address all
 * match - warnings that share a code but say different things are all kept.
 */
const dedupeWarnings = (warnings) => {
    const warningKeys = new Set();
    return warnings.filter((warning) => {
        const warningKey = `${warning.code}:${warning.content}:${warning.address || ''}`;
        if (warningKeys.has(warningKey))
            return false;
        warningKeys.add(warningKey);
        return true;
    });
};
exports.dedupeWarnings = dedupeWarnings;
/**
 * Adds warnings to the ones a call already carries, without repeating any. Modules run one after
 * another over the same call, so a module must never replace what an earlier one found. Returns
 * undefined when there is nothing to report, so calls without warnings keep their original shape.
 */
const mergeWarnings = (existingWarnings, addedWarnings) => {
    if (!existingWarnings?.length && !addedWarnings.length)
        return undefined;
    return (0, exports.dedupeWarnings)([...(existingWarnings || []), ...addedWarnings]);
};
exports.mergeWarnings = mergeWarnings;
/**
 * Marks an approval that has no spending limit. `SignAccountOpController` removes warnings with
 * this code when the app that made the request is in the default Ambire catalog, so every module
 * that reports an unlimited approval must use this exact code.
 */
exports.UNLIMITED_APPROVAL_WARNING_CODE = 'UNLIMITED_APPROVAL';
const MAX_AMOUNT_BY_BITS = {
    256: 2n ** 256n - 1n,
    160: 2n ** 160n - 1n
};
/**
 * True when the amount is the largest value its type can hold. Contracts use this value to mean
 * "no limit". Only the exact maximum counts, so a large but finite approval is not reported.
 */
const isUnlimitedAmount = (amount, bits = 256) => amount === MAX_AMOUNT_BY_BITS[bits];
exports.isUnlimitedAmount = isUnlimitedAmount;
/**
 * Warns that an approval lets the spender take any amount of the token, with no limit. The address
 * is lowercased to match `getAddressVisualization`, so both spellings of it compare as equal.
 */
const getUnlimitedApprovalWarning = (spender) => getWarning('This app can spend this token from your account with no limit. Continue only if you trust it.', exports.UNLIMITED_APPROVAL_WARNING_CODE, false, spender.toLowerCase());
exports.getUnlimitedApprovalWarning = getUnlimitedApprovalWarning;
const randomId = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
exports.randomId = randomId;
function getLabel(content, isBold) {
    return { type: 'label', content: content.toString(), id: (0, exports.randomId)(), isBold };
}
function getAction(content, options) {
    return { type: 'action', content, id: (0, exports.randomId)(), warning: options?.warning };
}
function getImage(content) {
    return { type: 'image', content, id: (0, exports.randomId)() };
}
function getBreak() {
    return { type: 'break', id: (0, exports.randomId)() };
}
function getAddressVisualization(_address) {
    const address = _address.toLowerCase();
    return { type: 'address', address, id: (0, exports.randomId)() };
}
function getToken(_address, amount, chainId) {
    const address = _address.toLowerCase();
    return {
        type: 'token',
        address,
        value: BigInt(amount),
        id: (0, exports.randomId)(),
        chainId
    };
}
function getTokenWithChain(address, amount, chainId) {
    return getToken(address, amount, chainId);
}
function getChain(chainId) {
    return { type: 'chain', id: (0, exports.randomId)(), chainId };
}
function getText(text, mlMi) {
    return { type: 'text', content: text, id: (0, exports.randomId)(), mlMi };
}
/** The visualizations a row renders - a `call` row keeps its parts flat, every other row has one. */
function getErc7730RowValues(row) {
    return row.type === 'call' ? row.value : [row.value];
}
/** A `call` row renders an embedded call inline and has no label of its own. */
function getErc7730RowLabel(row) {
    return row.type === 'call' ? '' : row.label;
}
function getErc7730Visualization(intent, rows, dapp, 
// Present only when the format used an `interpolatedIntent` that fully
// resolved: `parts` is the structured breakdown to render, `usedFieldPaths`
// is which fields (by `HumanizerErc7730Row.path`) it already rendered inline
// - see `excludedFieldPaths` on `HumanizerErc7730Visualization`.
interpolated) {
    return {
        type: 'erc7730',
        // When interpolation succeeded, show the rich breakdown and exclude
        // whatever fields it already rendered inline (that can legitimately be
        // every field, e.g. when the whole template referenced them all).
        // Otherwise there was nothing rendered inline to exclude anything for, so
        // this falls back to the plain action with nothing excluded.
        intent: interpolated?.parts ?? (intent ? [getAction(intent)] : []),
        excludedFieldPaths: interpolated?.usedFieldPaths ?? [],
        fields: rows,
        dapp,
        id: (0, exports.randomId)()
    };
}
function flattenHumanizerVisualizations(visualizations = []) {
    return visualizations.flatMap((visualization) => {
        if (visualization.type !== 'erc7730')
            return [visualization];
        return [
            visualization,
            // `fields` (every field, not just the ones displayed as rows) so nested
            // values that only show up inline in `intent` (e.g. a token amount) are
            // still discovered here.
            ...flattenHumanizerVisualizations(visualization.fields.flatMap(getErc7730RowValues))
        ];
    });
}
function hasErc7730Humanization(humanization) {
    return !!humanization?.some((call) => flattenHumanizerVisualizations(call.fullVisualization).some((visualization) => visualization.type === 'erc7730'));
}
function getOnBehalfOf(onBehalfOf, sender) {
    return onBehalfOf.toLowerCase() !== sender.toLowerCase()
        ? [getLabel('on behalf of'), getAddressVisualization(onBehalfOf)]
        : [];
}
// @TODO on some humanization of uniswap there is recipient 0x000...000
function getRecipientText(from, recipient) {
    return from.toLowerCase() === recipient.toLowerCase()
        ? []
        : [getLabel('and send it to'), getAddressVisualization(recipient)];
}
function getDeadlineText(deadline) {
    const minute = 60000n;
    const diff = BigInt(deadline) - BigInt(Date.now());
    if (diff < 0 && diff > -minute * 2n)
        return 'expired just now';
    if (diff < 0)
        return 'already expired';
    if (diff < minute)
        return 'expires in less than a minute';
    if (diff < 30n * minute)
        return `expires in ${Math.floor(Number(diff / minute))} minutes`;
    if ((deadline / 1000n).toString(16) === 'f'.repeat(64))
        return 'No expiration date';
    if (deadline.toString(16) === 'f'.repeat(64))
        return 'No expiration date';
    const deadlineDate = new Date(Number(deadline));
    if (isNaN(deadlineDate.getTime()))
        return 'Invalid expiration date';
    return `valid until ${deadlineDate.toLocaleString()}`;
}
function getDeadline(deadlineSecs) {
    const deadline = BigInt(deadlineSecs) * 1000n;
    return {
        type: 'deadline',
        value: deadline,
        id: (0, exports.randomId)()
    };
}
function getLink(url, content) {
    return { type: 'link', url, content, id: (0, exports.randomId)() };
}
function getWrapping(address, amount) {
    return [getAction('Wrap'), getToken(address, amount)];
}
function getUnwrapping(address, amount) {
    return [getAction('Unwrap'), getToken(address, amount)];
}
// @TODO cant this be used in the <Address component>
function getKnownName(humanizerMeta, address) {
    if (!(0, viem_1.isAddress)(address))
        return;
    return humanizerMeta?.knownAddresses?.[(0, viem_1.getAddress)(address)]?.name;
}
// Looks up a 4-byte function selector across every known ABI (not just the ABI of the call's
// target contract), since humanizerMeta has no reverse index from contract address to ABI name.
function getKnownFunctionName(humanizerMeta, selector) {
    const normalizedSelector = selector.toLowerCase();
    const matchingFragment = Object.values(humanizerMeta?.abis || {})
        .map((abi) => abi[normalizedSelector])
        .find((fragment) => fragment?.type === 'function');
    const signaturePrefix = 'function ';
    const functionSignature = matchingFragment?.signature.startsWith(signaturePrefix)
        ? matchingFragment.signature.slice(signaturePrefix.length)
        : undefined;
    const functionNameEnd = functionSignature?.indexOf('(') ?? -1;
    return functionNameEnd >= 0 ? functionSignature?.slice(0, functionNameEnd).trim() : undefined;
}
exports.EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} };
const uintToAddress = (uint) => `0x${BigInt(uint).toString(16).slice(-40).padStart(40, '0')}`;
exports.uintToAddress = uintToAddress;
const eToNative = (address) => address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? viem_1.zeroAddress : address;
exports.eToNative = eToNative;
// tokens before solidity 0.5.0 would accept calldata that is shorter then the specified
// args in the abi and assume they are 0s
// other tokens fail onchain, so there is no real danger in padding to the end
// as long as it is kept in the humanizer
// applicable only to functions whose args are all static (one 32 byte word each)
const padCallData = (data, staticArgsCount) => {
    const expectedCallLength = 2 + 8 + staticArgsCount * 64;
    return data.padEnd(expectedCallLength, '0');
};
exports.padCallData = padCallData;
//# sourceMappingURL=utils.js.map