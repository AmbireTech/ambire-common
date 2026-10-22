import { Call } from '../accountOp/types';
import { AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { BaseAccount } from '../account/BaseAccount';
import { AccountOp } from '../accountOp/accountOp';
import { SubmittedAccountOp } from '../accountOp/submittedAccountOp';
import { TokenResult } from '../portfolio';
import { FullEstimation, FullEstimationSummary } from './interfaces';
export declare function getEstimation(baseAcc: BaseAccount, accountState: AccountOnchainState, op: AccountOp, network: Network, provider: RPCProvider, feeTokens: TokenResult[], nativeToCheck: string[], switcher: BundlerSwitcher, pendingUserOp?: SubmittedAccountOp): Promise<FullEstimation>;
export declare function getEstimationSummary(estimation: FullEstimation): FullEstimationSummary;
/**
 * Push extra gas limit for EOA / EOA7702 accounts to avoid OOG.
 * Also, push this extra gas limit if the accountOp isn't a single call with ETH send
 * which is fixed to 21k and no extra gas limit is needed
 */
export declare function getGasLimitWithOverheadForSelfEOA(gasLimit: bigint, calls: Call[]): bigint;
/**
 * Push extra gas limit for EOA broadcast when the account is smart.
 */
export declare function getGasLimitWithOverhead(gasLimit: bigint): bigint;
//# sourceMappingURL=estimate.d.ts.map