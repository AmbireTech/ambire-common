import { Network } from '../../interfaces/network';
import { Warning } from '../../interfaces/signAccountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { FeePaymentOption } from '../../libs/estimate/interfaces';
import { TokenResult } from '../../libs/portfolio';
import { AccountState } from '../../libs/portfolio/interfaces';
declare function getFeeSpeedIdentifier(option: FeePaymentOption, accountAddr: string, rbfAccountOp: SubmittedAccountOp | null): string;
declare function getTokenUsdAmount(token: TokenResult, gasAmount: bigint): string;
declare function getSignificantBalanceDecreaseWarning(latest: AccountState, pending: AccountState, networkId: Network['id']): Warning | null;
declare const getFeeTokenPriceUnavailableWarning: (hasSpeed: boolean, feeTokenHasPrice: boolean) => Warning | null;
export { getFeeSpeedIdentifier, getTokenUsdAmount, getSignificantBalanceDecreaseWarning, getFeeTokenPriceUnavailableWarning };
//# sourceMappingURL=helper.d.ts.map