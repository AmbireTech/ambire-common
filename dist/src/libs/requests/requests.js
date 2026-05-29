export const dappRequestMethodToRequestKind = (method) => {
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
export const isSignRequest = (kind) => kind === 'calls' ||
    kind === 'message' ||
    kind === 'typedMessage' ||
    kind === 'siwe' ||
    kind === 'authorization-7702';
export const messageOnNewRequest = (request, addType) => {
    let requestType = '';
    if (request.kind === 'calls')
        requestType = 'Sign Transaction';
    if (request.kind === 'message' ||
        request.kind === 'typedMessage' ||
        request.kind === 'authorization-7702' ||
        request.kind === 'siwe')
        requestType = 'Sign Message';
    if (request.kind === 'dappConnect')
        requestType = 'Dapp Connect';
    if (request.kind === 'walletAddEthereumChain')
        requestType = 'Add Chain';
    if (request.kind === 'walletWatchAsset')
        requestType = 'Watch Asset';
    if (request.kind === 'ethGetEncryptionPublicKey')
        requestType = 'Get Encryption Public Key';
    if (addType === 'queued') {
        return `A new${requestType ? ` ${requestType} ` : ' '}request was queued.`;
    }
    if (addType === 'updated') {
        return `${requestType ? ` ${requestType} ` : ' '}request was updated.`;
    }
    return null;
};
export const getCallsUserRequestsByNetwork = (accountAddr, userRequests) => {
    const callsUserRequests = userRequests.filter((r) => r.kind === 'calls').filter((req) => req.signAccountOp.accountOp.accountAddr === accountAddr);
    const requestsByNetwork = callsUserRequests.reduce((acc, req) => {
        const { chainId } = req.signAccountOp.accountOp;
        if (!acc[chainId.toString()])
            acc[chainId.toString()] = [];
        acc[chainId.toString()].push(req);
        return acc;
    }, {});
    return requestsByNetwork;
};
export const buildSwitchAccountUserRequest = ({ nextUserRequest, selectedAccountAddr, dappPromises }) => {
    return {
        id: new Date().getTime(),
        kind: 'switchAccount',
        meta: {
            accountAddr: selectedAccountAddr,
            switchToAccountAddr: nextUserRequest.meta.accountAddr,
            nextRequestKind: nextUserRequest.kind
        },
        dappPromises
    };
};
export const sumTopUps = (userRequests) => {
    return (userRequests
        .filter((req) => req.kind === 'calls')
        .filter((req) => req.signAccountOp.accountOp?.meta?.topUpAmount)
        .map((req) => req.signAccountOp.accountOp.meta.topUpAmount)
        .reduce((a, b) => a + b, 0n) ?? undefined);
};
//# sourceMappingURL=requests.js.map