import { Interface } from 'ethers';
import { AaveLendingPoolV2 } from '../../const/abis';
import { getAction, getAddressVisualization, getLabel, getOnBehalfOf, getToken } from '../../utils';
export const aaveLendingPoolV2 = () => {
    const iface = new Interface(AaveLendingPoolV2);
    const matcher = {
        [iface.getFunction('deposit')?.selector]: (accountOp, call) => {
            const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || [];
            return [
                getAction('Deposit'),
                getToken(asset, amount),
                getLabel('to'),
                getAddressVisualization(call.to),
                ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
            ];
        },
        [iface.getFunction('withdraw')?.selector]: (accountOp, call) => {
            const [asset, amount, onBehalf] = iface.parseTransaction(call)?.args || [];
            return [
                getAction('Withdraw'),
                getToken(asset, amount),
                getLabel('from'),
                getAddressVisualization(call.to),
                ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
            ];
        },
        [iface.getFunction('repay')?.selector]: (accountOp, call) => {
            const [asset, amount /* rateMode */, , onBehalf] = iface.parseTransaction(call)?.args || [];
            return [
                getAction('Repay'),
                getToken(asset, amount),
                getLabel('to'),
                getAddressVisualization(call.to),
                ...getOnBehalfOf(onBehalf, accountOp.accountAddr)
            ];
        },
        [iface.getFunction('borrow')?.selector]: (accountOp, call) => {
            const [asset, amount] = iface.parseTransaction(call)?.args || [];
            return [
                getAction('Borrow'),
                getToken(asset, amount),
                getLabel('from'),
                getAddressVisualization(call.to)
            ];
        }
    };
    return matcher;
};
//# sourceMappingURL=aaveLendingPoolV2.js.map