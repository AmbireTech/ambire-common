import { Interface } from 'ethers';
import { KyberSwap } from '../../const/abis';
import { eToNative, getAction, getLabel, getToken } from '../../utils';
const KyberModule = (accOp, calls) => {
    const iface = new Interface(KyberSwap);
    const matcher = {
        [iface.getFunction('swap(tuple(address callTarget,address approveTarget,bytes targetData,tuple(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution)')?.selector]: (call) => {
            const { execution: { desc: { srcToken, dstToken, amount, minReturnAmount } } } = iface.parseTransaction(call).args;
            return [
                getAction('Swap'),
                getToken(eToNative(srcToken), amount),
                getLabel('for'),
                getToken(eToNative(dstToken), minReturnAmount)
            ];
        },
        [iface.getFunction('swapSimpleMode(address caller, tuple(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes executorData,bytes clientData)')?.selector]: (call) => {
            const { desc: { srcToken, dstToken, amount, minReturnAmount } } = iface.parseTransaction(call).args;
            return [
                getAction('Swap'),
                getToken(eToNative(srcToken), amount),
                getLabel('for'),
                getToken(eToNative(dstToken), minReturnAmount)
            ];
        }
    };
    const newCalls = calls.map((call) => {
        if (call.fullVisualization || !matcher[call.data.slice(0, 10)])
            return call;
        return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) };
    });
    return newCalls;
};
export default KyberModule;
//# sourceMappingURL=index.js.map