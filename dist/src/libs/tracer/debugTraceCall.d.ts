import { JsonRpcProvider } from 'ethers';
import { Account, AccountOnchainState } from '../../interfaces/account';
import { AccountOp } from '../accountOp/accountOp';
import { GasRecommendation } from '../gasPrice/gasPrice';
export declare function debugTraceCall(account: Account, op: AccountOp, provider: JsonRpcProvider, accountState: AccountOnchainState, gasUsed: bigint, gasPrices: GasRecommendation[], supportsStateOverride: boolean, overrideData?: any): Promise<{
    tokens: string[];
    nfts: [string, bigint[]][];
}>;
//# sourceMappingURL=debugTraceCall.d.ts.map