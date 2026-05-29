import { Interface, ZeroAddress } from 'ethers';
import IERC20 from '../../../contracts/compiled/IERC20.json';
const ERC20Interface = new Interface(IERC20.abi);
const isTransferredTokenFeeOption = (feeOption, op) => {
    if (!op.meta?.allowTransferFeeTokenSelfReserve)
        return false;
    if (feeOption.token.flags.onGasTank ||
        feeOption.paidBy.toLowerCase() !== op.accountAddr.toLowerCase())
        return false;
    if (feeOption.token.address === ZeroAddress) {
        return op.calls.some((call) => call.value > 0n && call.data === '0x');
    }
    return op.calls.some((call) => {
        if (!call.to || call.to.toLowerCase() !== feeOption.token.address.toLowerCase())
            return false;
        try {
            ERC20Interface.decodeFunctionData('transfer', call.data);
            return true;
        }
        catch {
            return false;
        }
    });
};
const canFeeOptionCoverAmount = (feeOption, op, amount) => {
    return feeOption.availableAmount >= amount || isTransferredTokenFeeOption(feeOption, op);
};
export { canFeeOptionCoverAmount, isTransferredTokenFeeOption };
//# sourceMappingURL=feeOptions.js.map