import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils';
export const erc20Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    if (tm.types.Permit &&
        tm.primaryType === 'Permit' &&
        tm.message &&
        ['owner', 'spender', 'value', 'nonce', 'deadline'].every((i) => i in tm.message) &&
        tm.domain.verifyingContract) {
        return {
            fullVisualization: [
                getAction('Grant approval'),
                getLabel('for'),
                getToken(tm.domain.verifyingContract, tm.message.value),
                getLabel('to'),
                getAddressVisualization(tm.message.spender),
                tm.message.deadline ? getDeadline(tm.message.deadline) : null
            ].filter((x) => x)
        };
    }
    if (tm.types.PermitSingle &&
        tm.primaryType === 'PermitSingle' &&
        tm?.message?.spender &&
        tm?.message?.details?.token &&
        tm?.message?.details?.amount &&
        tm?.message?.details?.expiration) {
        return {
            fullVisualization: [
                getAction('Approve'),
                getAddressVisualization(tm.message.spender),
                getLabel('to use'),
                getToken(tm.message.details.token, BigInt(tm.message.details.amount)),
                getDeadline(tm.message.details.expiration)
            ]
        };
    }
    return { fullVisualization: [] };
};
//# sourceMappingURL=erc20Module.js.map