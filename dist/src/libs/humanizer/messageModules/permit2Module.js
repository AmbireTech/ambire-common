import { PANCAKE_SWAP_PERMIT_2_ADDRESS, PERMIT_2_ADDRESS } from '../../../consts/addresses';
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils';
export const permit2Module = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    if (!tm?.domain?.verifyingContract ||
        ![PERMIT_2_ADDRESS.toLowerCase(), PANCAKE_SWAP_PERMIT_2_ADDRESS.toLocaleLowerCase()].includes(tm.domain.verifyingContract.toLowerCase()))
        return { fullVisualization: [] };
    const messageType = tm?.types?.PermitSingle?.[0]?.type ||
        tm?.types?.PermitBatch?.[0]?.type ||
        tm.types?.PermitTransferFrom?.[0]?.type;
    if (!messageType)
        return { fullVisualization: [] };
    if (messageType === 'TokenPermissions') {
        const { spender, nonce, deadline, permitted } = tm.message;
        if ([spender, nonce, deadline, permitted].some((a) => a === undefined))
            return { fullVisualization: [] };
        const { token, amount } = permitted;
        if (token === undefined || amount === undefined)
            return { fullVisualization: [] };
        return {
            fullVisualization: [
                getAction('Approve'),
                getAddressVisualization(spender),
                getLabel('to use'),
                getToken(token, amount),
                getDeadline(deadline)
            ]
        };
    }
    else if (['PermitDetails', 'PermitDetails[]'].includes(messageType)) {
        if (!tm.message.details)
            return { fullVisualization: [] };
        const permits = (messageType === 'PermitDetails' ? [tm.message.details] : tm.message.details).map((d) => ({
            token: d.token,
            amount: d.amount
        }));
        if (permits.some((p) => p.amount === undefined || p.token === undefined))
            return { fullVisualization: [] };
        if (!permits.length)
            return { fullVisualization: [] };
        const permitVisualizations = permits
            .map(({ token, amount }) => [
            getAddressVisualization(tm.message.spender),
            getLabel('to use'),
            getToken(token, amount),
            getLabel('and')
        ])
            .flat()
            .slice(0, -1);
        return {
            fullVisualization: [
                getAction('Approve'),
                ...permitVisualizations,
                getDeadline(tm.message.sigDeadline)
            ]
        };
    }
    return { fullVisualization: [] };
};
//# sourceMappingURL=permit2Module.js.map