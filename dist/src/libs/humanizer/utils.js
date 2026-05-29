import { getAddress, isAddress, isHex, zeroAddress } from 'viem';
/** Type guard that narrows an IrCall to one with a valid hex data field. */
export function isHexCall(call) {
    return isHex(call.data);
}
export function getWarning(content, code, blocking) {
    return { content, blocking, code };
}
export const randomId = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
export function getLabel(content, isBold) {
    return { type: 'label', content: content.toString(), id: randomId(), isBold };
}
export function getAction(content, options) {
    return { type: 'action', content, id: randomId(), warning: options?.warning };
}
export function getImage(content) {
    return { type: 'image', content, id: randomId() };
}
export function getBreak() {
    return { type: 'break', id: randomId() };
}
export function getAddressVisualization(_address) {
    const address = _address.toLowerCase();
    return { type: 'address', address, id: randomId() };
}
export function getToken(_address, amount, chainId) {
    const address = _address.toLowerCase();
    return {
        type: 'token',
        address,
        value: BigInt(amount),
        id: randomId(),
        chainId
    };
}
export function getTokenWithChain(address, amount, chainId) {
    return getToken(address, amount, chainId);
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
    if ((deadline / 1000n).toString(16) === 'f'.repeat(64))
        return 'No expiration date';
    if (deadline.toString(16) === 'f'.repeat(64))
        return 'No expiration date';
    const deadlineDate = new Date(Number(deadline));
    if (isNaN(deadlineDate.getTime()))
        return 'Invalid expiration date';
    return `valid until ${deadlineDate.toLocaleString()}`;
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
export function getWrapping(address, amount) {
    return [getAction('Wrap'), getToken(address, amount)];
}
export function getUnwrapping(address, amount) {
    return [getAction('Unwrap'), getToken(address, amount)];
}
// @TODO cant this be used in the <Address component>
export function getKnownName(humanizerMeta, address) {
    if (!isAddress(address))
        return;
    return humanizerMeta?.knownAddresses?.[getAddress(address)]?.name;
}
export const EMPTY_HUMANIZER_META = { abis: { NO_ABI: {} }, knownAddresses: {} };
export const uintToAddress = (uint) => `0x${BigInt(uint).toString(16).slice(-40).padStart(40, '0')}`;
export const eToNative = (address) => address.slice(2).toLocaleLowerCase() === 'e'.repeat(40) ? zeroAddress : address;
//# sourceMappingURL=utils.js.map