import { Interface } from 'ethers';
import { AmbireAccount } from '../../const/abis/AmbireAccount';
import { getAction, getAddressVisualization, getLabel } from '../../utils';
// the purpose of this module is simply to visualize attempts to hide ambire operations within the current account op
// such thing can be done if the dapp requests a tryCatch/executeBySelfSingle/executeBySelf function call directed to the current account
// this call will be executed without needing extra authentication. For more details check out AmbireAccount.sol
export const embeddedAmbireOperationHumanizer = (accountOp, irCalls) => {
    const iface = new Interface(AmbireAccount);
    const matcher = {
        [iface.getFunction('tryCatch').selector]: (originalCall) => {
            const { to, value, data } = iface.decodeFunctionData('tryCatch', originalCall.data);
            return [{ ...originalCall, to, value, data }];
        },
        [iface.getFunction('tryCatchLimit').selector]: (originalCall) => {
            const { to, value, data } = iface.decodeFunctionData('tryCatchLimit', originalCall.data);
            return [{ ...originalCall, to, value, data }];
        },
        [iface.getFunction('executeBySelfSingle').selector]: (originalCall) => {
            const { call: { to, value, data } } = iface.decodeFunctionData('executeBySelfSingle', originalCall.data);
            return [{ ...originalCall, to, value, data }];
        },
        [iface.getFunction('executeBySelf').selector]: (originalCall) => {
            const { calls } = iface.decodeFunctionData('executeBySelf', originalCall.data);
            // ethers returns Result type, which we do not want to leak in the result
            return calls.map(({ to, value, data }) => ({ ...originalCall, to, value, data }));
        }
    };
    const functionSelectorsCallableFromSigner = ['execute', 'executeMultiple', 'executeBySender'].map((i) => iface.getFunction(i).selector);
    const functionSelectorsCallableFromSelf = [
        'tryCatch',
        'tryCatch',
        'executeBySelfSingle',
        'executeBySelf'
    ].map((i) => iface.getFunction(i).selector);
    const newCalls = [];
    irCalls.forEach((call) => {
        if (call.to?.toLowerCase() === accountOp.accountAddr.toLowerCase() &&
            matcher[call.data.slice(0, 10)]) {
            newCalls.push(...matcher[call.data.slice(0, 10)](call));
            return;
        }
        if (functionSelectorsCallableFromSigner.includes(call.data.slice(0, 10))) {
            newCalls.push({
                ...call,
                fullVisualization: [
                    getAction('Execute calls'),
                    getLabel('from'),
                    getAddressVisualization(call.to)
                ]
            });
            return;
        }
        newCalls.push(call);
    });
    // if an attacker hides some call deeper inside a method, callable from self
    const hasParsableCalls = newCalls.some((call) => 
    // we could unwrap more
    functionSelectorsCallableFromSelf.includes(call.data.slice(0, 10)) ||
        // an unwrapped call could get humanization here
        (functionSelectorsCallableFromSigner.includes(call.data.slice(0, 10)) &&
            !call.fullVisualization?.length));
    return hasParsableCalls
        ? embeddedAmbireOperationHumanizer(accountOp, newCalls, {})
        : newCalls;
};
//# sourceMappingURL=index.js.map