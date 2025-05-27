"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageOnNewAction = exports.getAccountOpFromAction = exports.getAccountOpActionsByNetwork = exports.dappRequestMethodToActionKind = void 0;
const dappRequestMethodToActionKind = (method) => {
    if (['call', 'calls', 'eth_sendTransaction', 'wallet_sendCalls'].includes(method))
        return 'calls';
    if ([
        'eth_signTypedData',
        'eth_signTypedData_v1',
        'eth_signTypedData_v3',
        'eth_signTypedData_v4'
    ].includes(method))
        return 'typedMessage';
    if (['personal_sign'].includes(method))
        return 'message';
    // method to camelCase
    return method.replace(/_(.)/g, (m, p1) => p1.toUpperCase());
};
exports.dappRequestMethodToActionKind = dappRequestMethodToActionKind;
const getAccountOpActionsByNetwork = (accountAddr, actions) => {
    const accountOpActions = actions.filter((a) => a.type === 'accountOp').filter((action) => action.accountOp.accountAddr === accountAddr);
    const actionsByNetwork = accountOpActions.reduce((acc, accountOpAction) => {
        const { chainId } = accountOpAction.accountOp;
        if (!acc[chainId.toString()])
            acc[chainId.toString()] = [];
        acc[chainId.toString()].push(accountOpAction);
        return acc;
    }, {});
    return actionsByNetwork;
};
exports.getAccountOpActionsByNetwork = getAccountOpActionsByNetwork;
const getAccountOpFromAction = (accountOpActionId, actions) => {
    const accountOpAction = actions.find((a) => a.id === accountOpActionId);
    if (!accountOpAction)
        return undefined;
    return accountOpAction.accountOp;
};
exports.getAccountOpFromAction = getAccountOpFromAction;
const messageOnNewAction = (action, addType) => {
    let requestType = '';
    if (action.type === 'accountOp')
        requestType = 'Sign Transaction';
    if (action.type === 'signMessage')
        requestType = 'Sign Message';
    if (action.type === 'dappRequest') {
        if (action.userRequest.action.kind === 'dappConnect')
            requestType = 'Dapp Connect';
        if (action.userRequest.action.kind === 'walletAddEthereumChain')
            requestType = 'Add Chain';
        if (action.userRequest.action.kind === 'walletWatchAsset')
            requestType = 'Watch Asset';
        if (action.userRequest.action.kind === 'ethGetEncryptionPublicKey')
            requestType = 'Get Encryption Public Key';
    }
    if (addType === 'queued') {
        return `A new${requestType ? ` ${requestType} ` : ' '}request was queued.`;
    }
    if (addType === 'updated') {
        return `${requestType ? ` ${requestType} ` : ' '}request was updated.`;
    }
    return null;
};
exports.messageOnNewAction = messageOnNewAction;
//# sourceMappingURL=actions.js.map