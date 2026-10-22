import { TraceCallDiscoveryStatus, Warning } from '../../interfaces/signAccountOp';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { FeePaymentOption } from '../../libs/estimate/interfaces';
import { TokenResult } from '../../libs/portfolio';
import { AccountState } from '../../libs/portfolio/interfaces';
export type SignAccountOpType = 'default' | 'one-click-swap-and-bridge' | 'one-click-transfer';
declare function getFeeSpeedIdentifier(option: FeePaymentOption, accountAddr: string): string;
declare function getTokenUsdAmount(token: TokenResult, gasAmount: bigint): string;
declare function getSignificantBalanceDecreaseWarning(portfolioState: AccountState, chainId: bigint, discoveryStatus: TraceCallDiscoveryStatus): Warning | null;
declare const getUnknownTokenWarning: (pending: AccountState, chainId: bigint) => Warning | null;
declare const getFeeTokenPriceUnavailableWarning: (hasSpeed: boolean, feeTokenHasPrice: boolean, areTokenPricesEnabled: boolean) => Warning | null;
declare function getSafeDelegateCallWarning(accountOp: AccountOp): Warning | null;
declare function getSafeGasRefundWarning(accountOp: AccountOp): Warning | null;
declare const isUnderpriced: (msg: string) => boolean;
export { getFeeSpeedIdentifier, getFeeTokenPriceUnavailableWarning, getSafeDelegateCallWarning, getSafeGasRefundWarning, getSignificantBalanceDecreaseWarning, getTokenUsdAmount, getUnknownTokenWarning, isUnderpriced };
//# sourceMappingURL=helper.d.ts.map