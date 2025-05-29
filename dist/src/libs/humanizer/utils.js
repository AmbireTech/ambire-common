"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eToNative = exports.uintToAddress = exports.EMPTY_HUMANIZER_META = exports.randomId = void 0;
exports.getWarning = getWarning;
exports.getLabel = getLabel;
exports.getAction = getAction;
exports.getImage = getImage;
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
exports.checkIfUnknownAction = checkIfUnknownAction;
exports.getWrapping = getWrapping;
exports.getUnwrapping = getUnwrapping;
exports.getKnownName = getKnownName;
const ethers_1 = require("ethers");
function getWarning(content, level = 'caution') {
    return { content, level };
}
const randomId = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
exports.randomId = randomId;
function getLabel(content, isBold) {
    return { type: 'label', content, id: (0, exports.randomId)(), isBold };
}
function getAction(content) {
    return { type: 'action', content, id: (0, exports.randomId)() };
}
function getImage(content) {
    return { type: 'image', content, id: (0, exports.randomId)() };
}
function getAddressVisualization(_address) {
    const address = _address.toLowerCase();
    return { type: 'address', address, id: (0, exports.randomId)() };
}
function getToken(_address, amount, isHidden, chainId) {
    const address = _address.toLowerCase();
    return {
        type: 'token',
        address,
        value: BigInt(amount),
        id: (0, exports.randomId)(),
        isHidden,
        chainId
    };
}
function getTokenWithChain(address, amount, chainId) {
    return getToken(address, amount, undefined, chainId);
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
    return `valid until ${new Date(Number(deadline)).toLocaleString()}`;
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
function checkIfUnknownAction(v) {
    return !!(v && v[0]?.type === 'action' && v?.[0]?.content?.startsWith('Unknown action'));
}
function getWrapping(address, amount) {
    return [getAction('Wrap'), getToken(address, amount)];
}
function getUnwrapping(address, amount) {
    return [getAction('Unwrap'), getToken(address, amount)];
}
// @TODO cant this be used in the <Address component>
function getKnownName(humanizerMeta, address) {
    return humanizerMeta?.knownAddresses?.[address.toLowerCase()]?.name;
}
exports.EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} };
const uintToAddress = (uint) => `0x${BigInt(uint).toString(16).slice(-40).padStart(40, '0')}`;
exports.uintToAddress = uintToAddress;
const eToNative = (address) => address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? ethers_1.ZeroAddress : address;
exports.eToNative = eToNative;
//# sourceMappingURL=utils.js.map