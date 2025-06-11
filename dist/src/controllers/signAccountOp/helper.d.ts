import { TraceCallDiscoveryStatus, Warning } from '../../interfaces/signAccountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { FeePaymentOption } from '../../libs/estimate/interfaces';
import { TokenResult } from '../../libs/portfolio';
import { AccountState } from '../../libs/portfolio/interfaces';
export declare const SIGN_ACCOUNT_OP_MAIN = "signAccountOpMain";
export declare const SIGN_ACCOUNT_OP_SWAP = "signAccountOpSwap";
export type SignAccountOpType = 'signAccountOpMain' | 'signAccountOpSwap';
declare function getFeeSpeedIdentifier(option: FeePaymentOption, accountAddr: string, rbfAccountOp: SubmittedAccountOp | null): string;
declare function getUsdAmount(usdPrice: number, tokenDecimals: number, gasAmount: bigint): string;
declare function getTokenUsdAmount(token: TokenResult, gasAmount: bigint): string;
declare function getSignificantBalanceDecreaseWarning(latest: AccountState, pending: AccountState, chainId: bigint, traceCallDiscoveryStatus: TraceCallDiscoveryStatus): Warning | null;
declare const getFeeTokenPriceUnavailableWarning: (hasSpeed: boolean, feeTokenHasPrice: boolean) => Warning | null;
export { getFeeSpeedIdentifier, getFeeTokenPriceUnavailableWarning, getSignificantBalanceDecreaseWarning, getTokenUsdAmount, getUsdAmount };
//# sourceMappingURL=helper.d.ts.map