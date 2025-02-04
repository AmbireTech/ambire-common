import { isHexString, toUtf8Bytes, toUtf8String } from 'ethers';
import { getAction, getAddressVisualization, getLabel } from '../utils';
export const legendsMessageModule = (message) => {
    if (message.content.kind !== 'message' || typeof message.content.message !== 'string')
        return { fullVisualization: [] };
    let messageAsText = message.content.message;
    if (isHexString(message.content.message) && message.content.message.length % 2 === 0) {
        messageAsText = toUtf8String(toUtf8Bytes(message.content.message));
    }
    const messageRegex = /Assign 0x[a-fA-F0-9]{40} to Ambire Legends 0x[a-fA-F0-9]{40}/;
    const addressRegex = /0x[a-fA-F0-9]{40}/g;
    if (messageAsText.match(messageRegex) &&
        messageAsText.match(addressRegex)[0] === message.accountAddr)
        return {
            fullVisualization: [
                getAction('Link'),
                getAddressVisualization(messageAsText.match(addressRegex)[0]),
                getLabel('to'),
                getAddressVisualization(messageAsText.match(addressRegex)[1]),
                getLabel('for Ambire Legends', true)
            ]
        };
    return { fullVisualization: [] };
};
//# sourceMappingURL=legendsModule.js.map