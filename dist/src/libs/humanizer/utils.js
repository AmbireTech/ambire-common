import { ZeroAddress } from 'ethers';
import { geckoIdMapper } from '../../consts/coingecko';
const baseUrlCena = 'https://cena.ambire.com/api/v3';
export function getWarning(content, level = 'caution') {
    return { content, level };
}
export const randomId = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
export function getLabel(content, isBold) {
    return { type: 'label', content, id: randomId(), isBold };
}
export function getAction(content) {
    return { type: 'action', content, id: randomId() };
}
export function getImage(content) {
    return { type: 'image', content, id: randomId() };
}
export function getAddressVisualization(_address) {
    const address = _address.toLowerCase();
    return { type: 'address', address, id: randomId() };
}
export function getToken(_address, amount, isHidden, chainId) {
    const address = _address.toLowerCase();
    return {
        type: 'token',
        address,
        value: BigInt(amount),
        id: randomId(),
        isHidden,
        chainId
    };
}
export function getTokenWithChain(address, amount, chainId) {
    return getToken(address, amount, undefined, chainId);
}
export function getChain(chainId) {
    return { type: 'chain', id: randomId(), chainId };
}
export function getText(text) {
    return { type: 'text', content: text, id: randomId() };
}
export function getOnBehalfOf(onBehalfOf, sender) {
    return onBehalfOf.toLowerCase() !== sender.toLowerCase()
        ? [getLabel('on behalf of'), getAddressVisualization(onBehalfOf)]
        : [];
}
// @TODO on some humanization of uniswap there is recipient 0x000...000
export function getRecipientText(from, recipient) {
    return from.toLowerCase() === recipient.toLowerCase()
        ? []
        : [getLabel('and send it to'), getAddressVisualization(recipient)];
}
export function getDeadlineText(deadline) {
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
export function getDeadline(deadlineSecs) {
    const deadline = BigInt(deadlineSecs) * 1000n;
    return {
        type: 'deadline',
        value: deadline,
        id: randomId()
    };
}
export function getLink(url, content) {
    return { type: 'link', url, content, id: randomId() };
}
/**
 * Make a request to coingecko to fetch the latest price of the native token.
 * This is used by benzina and hence we cannot wrap the errors in emitError
 */
// @TODO this shouldn't be here, a more suitable place would be portfolio/gecko
export async function getNativePrice(network, fetch) {
    const platformId = geckoIdMapper(ZeroAddress, network);
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
export function checkIfUnknownAction(v) {
    return !!(v && v[0]?.type === 'action' && v?.[0]?.content?.startsWith('Unknown action'));
}
export function getUnknownVisualization(name, call) {
    const unknownVisualization = [
        getAction(`Unknown action (${name})`),
        getLabel('to'),
        getAddressVisualization(call.to)
    ];
    if (call.value)
        unknownVisualization.push(...[getLabel('and'), getAction('Send'), getToken(ZeroAddress, call.value)]);
    return unknownVisualization;
}
export function getWrapping(address, amount) {
    return [getAction('Wrap'), getToken(address, amount)];
}
export function getUnwrapping(address, amount) {
    return [getAction('Unwrap'), getToken(address, amount)];
}
// @TODO cant this be used in the <Address component>
export function getKnownName(humanizerMeta, address) {
    return humanizerMeta?.knownAddresses?.[address.toLowerCase()]?.name;
}
export const EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} };
export const uintToAddress = (uint) => `0x${BigInt(uint).toString(16).slice(-40).padStart(40, '0')}`;
export const eToNative = (address) => address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? ZeroAddress : address;
//# sourceMappingURL=utils.js.map