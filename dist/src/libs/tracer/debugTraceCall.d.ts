import { JsonRpcProvider } from 'ethers';
import { Account, AccountOnchainState } from '../../interfaces/account';
import { AccountOp } from '../accountOp/accountOp';
export declare function debugTraceCall(account: Account, op: AccountOp, provider: JsonRpcProvider, accountState: AccountOnchainState, supportsStateOverride: boolean, overrideData?: any): Promise<{
    tokens: string[];
    nfts: [string, bigint[]][];
}>;
//# sourceMappingURL=debugTraceCall.d.ts.map