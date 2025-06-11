"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountOpsForSimulation = exports.makeAccountOpAction = exports.buildSwitchAccountUserRequest = exports.ACCOUNT_SWITCH_USER_REQUEST = exports.batchCallsFromUserRequests = void 0;
const tslib_1 = require("tslib");
const generateSpoofSig_1 = tslib_1.__importDefault(require("../../utils/generateSpoofSig"));
const account_1 = require("../account/account");
const batchCallsFromUserRequests = ({ accountAddr, chainId, userRequests }) => {
    return userRequests.filter((r) => r.action.kind === 'calls').reduce((uCalls, req) => {
        if (req.meta.chainId === chainId && req.meta.accountAddr === accountAddr) {
            const { calls } = req.action;
            calls.forEach((call) => uCalls.push({ ...call, fromUserRequestId: req.id }));
        }
        return uCalls;
    }, []);
};
exports.batchCallsFromUserRequests = batchCallsFromUserRequests;
exports.ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST';
const buildSwitchAccountUserRequest = ({ nextUserRequest, selectedAccountAddr, session, dappPromise }) => {
    return {
        id: exports.ACCOUNT_SWITCH_USER_REQUEST,
        action: {
            kind: 'switchAccount',
            params: {
                accountAddr: selectedAccountAddr,
                switchToAccountAddr: nextUserRequest.meta.accountAddr,
                nextRequestType: nextUserRequest.action.kind
            }
        },
        session,
        meta: {
            isSignAction: false,
            accountAddr: selectedAccountAddr,
            switchToAccountAddr: nextUserRequest.meta.accountAddr,
            nextRequestType: nextUserRequest.action.kind
        },
        dappPromise: dappPromise
            ? {
                ...dappPromise,
                resolve: () => { }
            }
            : undefined
    };
};
exports.buildSwitchAccountUserRequest = buildSwitchAccountUserRequest;
const makeAccountOpAction = ({ account, chainId, nonce, actionsQueue, userRequests }) => {
    const accountOpAction = actionsQueue.find((a) => a.type === 'accountOp' && a.id === `${account.addr}-${chainId}`);
    if (accountOpAction) {
        accountOpAction.accountOp.calls = (0, exports.batchCallsFromUserRequests)({
            accountAddr: account.addr,
            chainId,
            userRequests
        });
        // the nonce might have changed during estimation because of
        // a nonce discrepancy issue. This makes sure we're with the
        // latest nonce should the user decide to batch
        accountOpAction.accountOp.nonce = nonce;
        return accountOpAction;
    }
    // find the user request with a paymaster service
    const userReqWithPaymasterService = userRequests.find((req) => req.meta.accountAddr === account.addr &&
        req.meta.chainId === chainId &&
        req.meta.paymasterService);
    const paymasterService = userReqWithPaymasterService
        ? userReqWithPaymasterService.meta.paymasterService
        : undefined;
    // find the user request with a wallet send calls version if any
    const userReqWithWalletSendCallsVersion = userRequests.find((req) => req.meta.accountAddr === account.addr &&
        req.meta.chainId === chainId &&
        req.meta.walletSendCallsVersion);
    const walletSendCallsVersion = userReqWithWalletSendCallsVersion
        ? userReqWithWalletSendCallsVersion.meta.walletSendCallsVersion
        : undefined;
    // find the user request with a setDelegation meta property if any
    const userReqWithDelegation = userRequests.find((req) => req.meta.accountAddr === account.addr &&
        req.meta.chainId === chainId &&
        'setDelegation' in req.meta);
    const setDelegation = userReqWithDelegation ? userReqWithDelegation.meta.setDelegation : undefined;
    const accountOp = {
        accountAddr: account.addr,
        chainId,
        signingKeyAddr: null,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        nonce,
        signature: account.associatedKeys[0] ? (0, generateSpoofSig_1.default)(account.associatedKeys[0]) : null,
        accountOpToExecuteBefore: null, // @TODO from pending recoveries
        calls: (0, exports.batchCallsFromUserRequests)({
            accountAddr: account.addr,
            chainId,
            userRequests
        }),
        meta: {
            paymasterService,
            walletSendCallsVersion,
            setDelegation
        }
    };
    return {
        id: `${account.addr}-${chainId}`, // SA accountOpAction id
        type: 'accountOp',
        accountOp
    };
};
exports.makeAccountOpAction = makeAccountOpAction;
const getAccountOpsForSimulation = (account, visibleActionsQueue, networks) => {
    const isSmart = (0, account_1.isSmartAccount)(account);
    const accountOps = visibleActionsQueue.filter((a) => a.type === 'accountOp')
        .map((a) => a.accountOp)
        .filter((op) => {
        if (op.accountAddr !== account.addr)
            return false;
        const networkData = networks.find((n) => n.chainId === op.chainId);
        // We cannot simulate if the account isn't smart and the network's RPC doesn't support
        // state override
        return isSmart || (networkData && !networkData.rpcNoStateOverride);
    });
    if (!accountOps.length)
        return undefined;
    return accountOps.reduce((acc, accountOp) => {
        const { chainId } = accountOp;
        if (!acc[chainId.toString()])
            acc[chainId.toString()] = [];
        acc[chainId.toString()].push(accountOp);
        return acc;
    }, {});
};
exports.getAccountOpsForSimulation = getAccountOpsForSimulation;
//# sourceMappingURL=main.js.map