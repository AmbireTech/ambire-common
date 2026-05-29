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
//# sourceMappingURL=estimate.d.ts.map