import { Interface } from 'ethers';
import { Pancake } from '../../const/abis/Pancake';
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../../utils';
const iface = new Interface(Pancake);
const PancakeModule = (accOp, calls) => {
    const matcher = {
        [iface.getFunction('approve(address token, address spender, uint160 amount, uint48 expiration)')
            ?.selector]: (call) => {
            const { token, spender, amount, expiration } = iface.parseTransaction(call).args;
            const expirationHumanization = expiration > 0 ? getDeadline(expiration) : getLabel('now');
            if (amount > 0)
                return [
                    getAction('Approve'),
                    getAddressVisualization(spender),
                    getLabel('to use'),
                    getToken(token, amount),
                    expirationHumanization
                ];
            return [
                getAction('Revoke approval'),
                getToken(token, amount),
                getLabel('for'),
                getAddressVisualization(spender)
            ];
        }
    };
    const newCalls = calls.map((call) => {
        const selector = call.data.slice(0, 10);
        if (call.fullVisualization || !matcher[selector])
            return call;
        return { ...call, fullVisualization: matcher[selector](call) };
    });
    return newCalls;
};
export default PancakeModule;
//# sourceMappingURL=index.js.map