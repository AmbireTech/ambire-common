import { TraceCallDiscoveryStatus, Warning } from '../../interfaces/signAccountOp';
import { FeePaymentOption } from '../../libs/estimate/interfaces';
import { TokenResult } from '../../libs/portfolio';
import { AccountState } from '../../libs/portfolio/interfaces';
export type SignAccountOpType = 'default' | 'one-click-swap-and-bridge' | 'one-click-transfer';
declare function getFeeSpeedIdentifier(option: FeePaymentOption, accountAddr: string): string;
declare function getTokenUsdAmount(token: TokenResult, gasAmount: bigint): string;
declare function getSignificantBalanceDecreaseWarning(portfolioState: AccountState, chainId: bigint, traceCallDiscoveryStatus: TraceCallDiscoveryStatus): Warning | null;
declare const getUnknownTokenWarning: (pending: AccountState, chainId: bigint) => Warning | null;
declare const getFeeTokenPriceUnavailableWarning: (hasSpeed: boolean, feeTokenHasPrice: boolean) => Warning | null;
export { getFeeSpeedIdentifier, getFeeTokenPriceUnavailableWarning, getSignificantBalanceDecreaseWarning, getTokenUsdAmount, getUnknownTokenWarning };
//# sourceMappingURL=helper.d.ts.map