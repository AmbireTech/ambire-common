import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils';
const visualizePermit = (spender, tokenId, deadline, contract) => {
    const res = [
        getAction('Permit use of'),
        getToken(contract, tokenId),
        getLabel('to'),
        getAddressVisualization(spender)
    ];
    if (getDeadline(deadline))
        res.push(getDeadline(deadline));
    return res;
};
export const erc721Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    if (tm.types.Permit &&
        tm.primaryType === 'Permit' &&
        tm.message.spender &&
        tm.message.tokenId &&
        tm.message.nonce &&
        tm.message.deadline) {
        return {
            fullVisualization: visualizePermit(tm.message.spender, tm.message.tokenId, tm.message.deadline, tm.domain.verifyingContract)
        };
    }
    return { fullVisualization: [] };
};
//# sourceMappingURL=erc721Module.js.map