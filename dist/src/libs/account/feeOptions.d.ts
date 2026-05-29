import { AccountOp } from '../accountOp/accountOp';
import { FeePaymentOption } from '../estimate/interfaces';
declare const isTransferredTokenFeeOption: (feeOption: FeePaymentOption, op: AccountOp) => boolean;
declare const canFeeOptionCoverAmount: (feeOption: FeePaymentOption, op: AccountOp, amount: bigint) => boolean;
export { canFeeOptionCoverAmount, isTransferredTokenFeeOption };
//# sourceMappingURL=feeOptions.d.ts.map