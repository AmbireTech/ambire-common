import generateSpoofSig from '../../utils/generateSpoofSig';
import { isSmartAccount } from '../account/account';
import { getAccountOpsByNetwork } from '../actions/actions';
import { adjustEntryPointAuthorization } from '../signMessage/signMessage';
export const batchCallsFromUserRequests = ({ accountAddr, networkId, userRequests }) => {
    return userRequests.filter((r) => r.action.kind === 'calls').reduce((uCalls, req) => {
        if (req.meta.networkId === networkId && req.meta.accountAddr === accountAddr) {
            const { calls } = req.action;
            calls.forEach((call) => uCalls.push({ ...call, fromUserRequestId: req.id }));
        }
        return uCalls;
    }, []);
};
export const ACCOUNT_SWITCH_USER_REQUEST = 'ACCOUNT_SWITCH_USER_REQUEST';
export const buildSwitchAccountUserRequest = ({ nextUserRequest, selectedAccountAddr, networkId, session, dappPromise }) => {
    return {
        id: ACCOUNT_SWITCH_USER_REQUEST,
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
export const makeSmartAccountOpAction = ({ account, networkId, nonce, actionsQueue, userRequests, entryPointAuthorizationSignature }) => {
    const accountOpAction = actionsQueue.find((a) => a.type === 'accountOp' && a.id === `${account.addr}-${networkId}`);
    if (accountOpAction) {
        accountOpAction.accountOp.calls = batchCallsFromUserRequests({
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
        signature: account.associatedKeys[0] ? generateSpoofSig(account.associatedKeys[0]) : null,
        accountOpToExecuteBefore: null,
        calls: batchCallsFromUserRequests({
            accountAddr: account.addr,
            networkId,
            userRequests
        }),
        meta: {
            entryPointAuthorization: entryPointAuthorizationSignature
                ? adjustEntryPointAuthorization(entryPointAuthorizationSignature)
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
export const makeBasicAccountOpAction = ({ account, networkId, nonce, userRequest }) => {
    const { calls } = userRequest.action;
    const accountOp = {
        accountAddr: account.addr,
        networkId,
        signingKeyAddr: null,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        nonce,
        signature: account.associatedKeys[0] ? generateSpoofSig(account.associatedKeys[0]) : null,
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
export const getAccountOpsForSimulation = (account, visibleActionsQueue, network, op) => {
    const isSmart = isSmartAccount(account);
    // if there's an op and the account is either smart or the network supports
    // state override, we pass it along. We do not support simulation for
    // EOAs on networks without state override (but it works for SA)
    if (op && (isSmart || (network && !network.rpcNoStateOverride)))
        return { [op.networkId]: [op] };
    if (isSmart)
        return getAccountOpsByNetwork(account.addr, visibleActionsQueue) || {};
    return {};
};
//# sourceMappingURL=main.js.map