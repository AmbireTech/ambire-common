"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWaitingForSafeDeployment = exports.isSignedSafeCallsRequest = exports.sumTopUps = exports.buildSwitchAccountUserRequest = exports.getCallsUserRequestsByNetwork = exports.messageOnNewRequest = exports.isSignRequest = exports.dappRequestMethodToRequestKind = void 0;
const uuid_1 = require("../../utils/uuid");
const dappRequestMethodToRequestKind = (method) => {
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
exports.dappRequestMethodToRequestKind = dappRequestMethodToRequestKind;
const isSignRequest = (kind) => kind === 'calls' ||
    kind === 'message' ||
    kind === 'typedMessage' ||
    kind === 'siwe' ||
    kind === 'authorization-7702';
exports.isSignRequest = isSignRequest;
const messageOnNewRequest = (request, addType) => {
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
exports.messageOnNewRequest = messageOnNewRequest;
const getCallsUserRequestsByNetwork = (accountAddr, userRequests) => {
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
exports.getCallsUserRequestsByNetwork = getCallsUserRequestsByNetwork;
const buildSwitchAccountUserRequest = ({ nextUserRequest, selectedAccountAddr, dappPromises }) => {
    return {
        id: (0, uuid_1.generateUuid)(),
        kind: 'switchAccount',
        meta: {
            accountAddr: selectedAccountAddr,
            switchToAccountAddr: nextUserRequest.meta.accountAddr,
            nextRequestKind: nextUserRequest.kind
        },
        dappPromises
    };
};
exports.buildSwitchAccountUserRequest = buildSwitchAccountUserRequest;
const sumTopUps = (userRequests) => {
    return (userRequests
        .filter((req) => req.kind === 'calls')
        .filter((req) => req.signAccountOp.accountOp?.meta?.topUpAmount)
        .map((req) => req.signAccountOp.accountOp.meta.topUpAmount)
        .reduce((a, b) => a + b, 0n) ?? undefined);
};
exports.sumTopUps = sumTopUps;
/**
 * True for a Safe transaction that at least one owner has already signed. Such a transaction
 * waits in the Safe queue for the other owners, so the wallet should open it only when the
 * user picks it.
 */
const isSignedSafeCallsRequest = (request) => request.kind === 'calls' &&
    !!request.signAccountOp.account.safeCreation &&
    !!request.signAccountOp.accountOp.signed?.length;
exports.isSignedSafeCallsRequest = isSignedSafeCallsRequest;
// todo: description
const isWaitingForSafeDeployment = (request, accountStates) => request.kind === 'calls' &&
    !!request.signAccountOp.account.safeCreation &&
    !accountStates[request.meta.accountAddr]?.[request.meta.chainId.toString()]?.isDeployed;
exports.isWaitingForSafeDeployment = isWaitingForSafeDeployment;
//# sourceMappingURL=requests.js.map