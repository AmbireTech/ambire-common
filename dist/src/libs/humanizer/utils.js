"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eToNative = exports.uintToAddress = exports.EMPTY_HUMANIZER_META = exports.getKnownName = exports.getUnwrapping = exports.getWrapping = exports.getUnknownVisualization = exports.checkIfUnknownAction = exports.getNativePrice = exports.getLink = exports.getDeadline = exports.getDeadlineText = exports.getRecipientText = exports.getOnBehalfOf = exports.getText = exports.getChain = exports.getTokenWithChain = exports.getToken = exports.getAddressVisualization = exports.getImage = exports.getAction = exports.getLabel = exports.randomId = exports.getWarning = void 0;
const ethers_1 = require("ethers");
const coingecko_1 = require("../../consts/coingecko");
const baseUrlCena = 'https://cena.ambire.com/api/v3';
function getWarning(content, level = 'caution') {
    return { content, level };
}
exports.getWarning = getWarning;
const randomId = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
exports.randomId = randomId;
function getLabel(content, isBold) {
    return { type: 'label', content, id: (0, exports.randomId)(), isBold };
}
exports.getLabel = getLabel;
function getAction(content) {
    return { type: 'action', content, id: (0, exports.randomId)() };
}
exports.getAction = getAction;
function getImage(content) {
    return { type: 'image', content, id: (0, exports.randomId)() };
}
exports.getImage = getImage;
function getAddressVisualization(_address) {
    const address = _address.toLowerCase();
    return { type: 'address', address, id: (0, exports.randomId)() };
}
exports.getAddressVisualization = getAddressVisualization;
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
exports.getToken = getToken;
function getTokenWithChain(address, amount, chainId) {
    return getToken(address, amount, undefined, chainId);
}
exports.getTokenWithChain = getTokenWithChain;
function getChain(chainId) {
    return { type: 'chain', id: (0, exports.randomId)(), chainId };
}
exports.getChain = getChain;
function getText(text) {
    return { type: 'text', content: text, id: (0, exports.randomId)() };
}
exports.getText = getText;
function getOnBehalfOf(onBehalfOf, sender) {
    return onBehalfOf.toLowerCase() !== sender.toLowerCase()
        ? [getLabel('on behalf of'), getAddressVisualization(onBehalfOf)]
        : [];
}
exports.getOnBehalfOf = getOnBehalfOf;
// @TODO on some humanization of uniswap there is recipient 0x000...000
function getRecipientText(from, recipient) {
    return from.toLowerCase() === recipient.toLowerCase()
        ? []
        : [getLabel('and send it to'), getAddressVisualization(recipient)];
}
exports.getRecipientText = getRecipientText;
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
exports.getDeadlineText = getDeadlineText;
function getDeadline(deadlineSecs) {
    const deadline = BigInt(deadlineSecs) * 1000n;
    return {
        type: 'deadline',
        value: deadline,
        id: (0, exports.randomId)()
    };
}
exports.getDeadline = getDeadline;
function getLink(url, content) {
    return { type: 'link', url, content, id: (0, exports.randomId)() };
}
exports.getLink = getLink;
/**
 * Make a request to coingecko to fetch the latest price of the native token.
 * This is used by benzina and hence we cannot wrap the errors in emitError
 */
// @TODO this shouldn't be here, a more suitable place would be portfolio/gecko
async function getNativePrice(network, fetch) {
    const platformId = (0, coingecko_1.geckoIdMapper)(ethers_1.ZeroAddress, network);
    if (!platformId) {
        throw new Error(`getNativePrice: ${network.name} is not supported`);
    }
    const queryUrl = `${baseUrlCena}/simple/price?ids=${platformId}&vs_currencies=usd`;
    let response = await fetch(queryUrl);
    response = await response.json();
    if (!response[platformId] || !response[platformId].usd) {
        throw new Error(`getNativePrice: could not fetch native token price for ${network.name} `);
    }
    return response[platformId].usd;
}
exports.getNativePrice = getNativePrice;
function checkIfUnknownAction(v) {
    return !!(v && v[0]?.type === 'action' && v?.[0]?.content?.startsWith('Unknown action'));
}
exports.checkIfUnknownAction = checkIfUnknownAction;
function getUnknownVisualization(name, call) {
    const unknownVisualization = [
        getAction(`Unknown action (${name})`),
        getLabel('to'),
        getAddressVisualization(call.to)
    ];
    if (call.value)
        unknownVisualization.push(...[getLabel('and'), getAction('Send'), getToken(ethers_1.ZeroAddress, call.value)]);
    return unknownVisualization;
}
exports.getUnknownVisualization = getUnknownVisualization;
function getWrapping(address, amount) {
    return [getAction('Wrap'), getToken(address, amount)];
}
exports.getWrapping = getWrapping;
function getUnwrapping(address, amount) {
    return [getAction('Unwrap'), getToken(address, amount)];
}
exports.getUnwrapping = getUnwrapping;
// @TODO cant this be used in the <Address component>
function getKnownName(humanizerMeta, address) {
    return humanizerMeta?.knownAddresses?.[address.toLowerCase()]?.name;
}
exports.getKnownName = getKnownName;
exports.EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} };
const uintToAddress = (uint) => `0x${BigInt(uint).toString(16).slice(-40).padStart(40, '0')}`;
exports.uintToAddress = uintToAddress;
const eToNative = (address) => address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? ethers_1.ZeroAddress : address;
exports.eToNative = eToNative;
//# sourceMappingURL=utils.js.map