import { getAction } from '../../utils';
// the purpose of this module is simply to visualize attempts to hide ambire operations within the current account op
// such thing can be done if the dapp requests a tryCatch/executeBySelfSingle/executeBySelf/... function call directed to the current account
// this call will be executed without needing extra authentication. For more details check out AmbireAccount.sol
export const embeddedAmbireOperationHumanizer = (accountOp, irCalls) => {
    return irCalls.map((call) => {
        if (!call.to)
            return call;
        if (call.data === '0x')
            return call;
        if (call.to.toLowerCase() === accountOp.accountAddr.toLowerCase()) {
            return {
                ...call,
                fullVisualization: [
                    getAction('Allow multiple actions from this account!', { warning: true })
                ]
            };
        }
        return call;
    });
};
//# sourceMappingURL=index.js.map