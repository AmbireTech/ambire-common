import { AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { BaseAccount } from '../account/BaseAccount';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
import { TokenResult } from '../portfolio';
import { AmbireEstimation } from './interfaces';
export declare function getInnerCallFailure(estimationOp: {
    success: boolean;
    err: string;
}, calls: Call[], network: Network, portfolioNativeValue?: bigint): Error | null;
export declare function getNonceDiscrepancyFailure(estimationNonce: bigint, outcomeNonce: number): Error | null;
export declare function ambireEstimateGas(baseAcc: BaseAccount, accountState: AccountOnchainState, op: AccountOp, network: Network, provider: RPCProvider, feeTokens: TokenResult[], nativeToCheck: string[]): Promise<AmbireEstimation | Error>;
//# sourceMappingURL=ambireEstimation.d.ts.map