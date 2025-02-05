"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountOpsForSimulation = exports.makeBasicAccountOpAction = exports.makeSmartAccountOpAction = exports.buildSwitchAccountUserRequest = exports.ACCOUNT_SWITCH_USER_REQUEST = exports.batchCallsFromUserRequests = void 0;
const tslib_1 = require("tslib");
const generateSpoofSig_1 = tslib_1.__importDefault(require("../../utils/generateSpoofSig"));
const account_1 = require("../account/account");
const actions_1 = require("../actions/actions");
const signMessage_1 = require("../signMessage/signMessage");
const batchCallsFromUserRequests = ({ accountAddr, networkId, userRequests }) => {
    return userRequests.filter((r) => r.action.kind === 'calls').reduce((uCalls, req) => {
        if (req.meta.networkId === networkId && req.meta.accountAddr === accountAddr) {
            const { calls } = req.action;
            calls.forEach((call) => uCalls.push({ ...call, fromUserRequestId: req.id }));
        }
        return uCalls;
    }, []);
};
exports.batchCallsFromUserRequests = batchCallsFromUserRequests;
exports.ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST';
const buildSwitchAccountUserRequest = ({ nextUserRequest, selectedAccountAddr, networkId, session, dappPromise }) => {
    return {
        id: exports.ACCOUNT_SWITCH_USER_REQUEST,
        action: {
            kind: 'switchAccount',
            params: {
                accountAddr: selectedAccountAddr,
                switchToAccountAddr: nextUserRequest.meta.accountAddr,
                nextRequestType: nextUserRequest.action.kind,
                networkId
            }
        },
        session,
        meta: {
            isSignAction: false
        },
        dappPromise: {
            ...dappPromise,
            resolve: () => { }
        }
    };
};
exports.buildSwitchAccountUserRequest = buildSwitchAccountUserRequest;
const makeSmartAccountOpAction = ({ account, networkId, nonce, actionsQueue, userRequests, entryPointAuthorizationSignature }) => {
    const accountOpAction = actionsQueue.find((a) => a.type === 'accountOp' && a.id === `${account.addr}-${networkId}`);
    if (accountOpAction) {
        accountOpAction.accountOp.calls = (0, exports.batchCallsFromUserRequests)({
            accountAddr: account.addr,
            networkId,
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
        req.meta.networkId === networkId &&
        req.meta.paymasterService);
    const paymasterService = userReqWithPaymasterService
        ? userReqWithPaymasterService.meta.paymasterService
        : undefined;
    const accountOp = {
        accountAddr: account.addr,
        networkId,
        signingKeyAddr: null,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        nonce,
        signature: account.associatedKeys[0] ? (0, generateSpoofSig_1.default)(account.associatedKeys[0]) : null,
        accountOpToExecuteBefore: null,
        calls: (0, exports.batchCallsFromUserRequests)({
            accountAddr: account.addr,
            networkId,
            userRequests
        }),
        meta: {
            entryPointAuthorization: entryPointAuthorizationSignature
                ? (0, signMessage_1.adjustEntryPointAuthorization)(entryPointAuthorizationSignature)
                : undefined,
            paymasterService
        }
    };
    return {
        id: `${account.addr}-${networkId}`,
        type: 'accountOp',
        accountOp
    };
};
exports.makeSmartAccountOpAction = makeSmartAccountOpAction;
const makeBasicAccountOpAction = ({ account, networkId, nonce, userRequest }) => {
    const { calls } = userRequest.action;
    const accountOp = {
        accountAddr: account.addr,
        networkId,
        signingKeyAddr: null,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        nonce,
        signature: account.associatedKeys[0] ? (0, generateSpoofSig_1.default)(account.associatedKeys[0]) : null,
        accountOpToExecuteBefore: null,
        calls: calls.map((call) => ({ ...call, fromUserRequestId: userRequest.id }))
    };
    return {
        // BA accountOpAction id same as the userRequest's id because for each call we have an action
        id: userRequest.id,
        type: 'accountOp',
        accountOp
    };
};
exports.makeBasicAccountOpAction = makeBasicAccountOpAction;
const getAccountOpsForSimulation = (account, visibleActionsQueue, network, op) => {
    const isSmart = (0, account_1.isSmartAccount)(account);
    // if there's an op and the account is either smart or the network supports
    // state override, we pass it along. We do not support simulation for
    // EOAs on networks without state override (but it works for SA)
    if (op && (isSmart || (network && !network.rpcNoStateOverride)))
        return { [op.networkId]: [op] };
    if (isSmart)
        return (0, actions_1.getAccountOpsByNetwork)(account.addr, visibleActionsQueue) || {};
    return {};
};
exports.getAccountOpsForSimulation = getAccountOpsForSimulation;
//# sourceMappingURL=main.js.map