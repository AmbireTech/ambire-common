import { isAddress, toUtf8String } from 'ethers';
import { getAction, getAddressVisualization, getLabel } from '../utils';
export const fallbackShortPlaintext = (message) => {
    if (message.content.kind !== 'message' ||
        typeof message.content.message !== 'string' ||
        message.content.message.length >= 200)
        return { fullVisualization: [] };
    // the message should be hex always. If it is not, the issue is not in this module and
    // should be resolved upstream
    const readableText = toUtf8String(message.content.message);
    if (readableText.includes('\n'))
        return { fullVisualization: [] };
    return {
        fullVisualization: [
            getAction('Message: '),
            ...readableText
                .split(' ')
                .map((w) => (isAddress(w) ? getAddressVisualization(w) : getLabel(w)))
        ],
        canHideDropdownArrow: true
    };
};
//# sourceMappingURL=fallbackShortPlaintext.js.map