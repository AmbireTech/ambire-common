"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eToNative = exports.uintToAddress = exports.EMPTY_HUMANIZER_META = exports.randomId = void 0;
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
exports.getOnBehalfOf = getOnBehalfOf;
exports.getRecipientText = getRecipientText;
exports.getDeadlineText = getDeadlineText;
exports.getDeadline = getDeadline;
exports.getLink = getLink;
exports.getWrapping = getWrapping;
exports.getUnwrapping = getUnwrapping;
exports.getKnownName = getKnownName;
const viem_1 = require("viem");
/** Type guard that narrows an IrCall to one with a valid hex data field. */
function isHexCall(call) {
    return (0, viem_1.isHex)(call.data);
}
function getWarning(content, code, blocking) {
    return { content, blocking, code };
}
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
function getText(text) {
    return { type: 'text', content: text, id: (0, exports.randomId)() };
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
exports.EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} };
const uintToAddress = (uint) => `0x${BigInt(uint).toString(16).slice(-40).padStart(40, '0')}`;
exports.uintToAddress = uintToAddress;
const eToNative = (address) => address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? viem_1.zeroAddress : address;
exports.eToNative = eToNative;
//# sourceMappingURL=utils.js.map