import { getAction, getAddressVisualization, getChain, getLabel, getText } from '../utils';
export const eip7702AuthorizationModule = (message) => {
    if (message.content.kind !== 'authorization-7702')
        return { fullVisualization: [] };
    return {
        fullVisualization: [
            getAction('EIP-7702 Authorization'),
            getChain(message.chainId),
            getText('Nonce'),
            getLabel(message.content.nonce.toString()),
            getText('Implementation'),
            getAddressVisualization(message.content.contractAddr)
        ]
    };
};
//# sourceMappingURL=eip7702AuthorizationModule.js.map