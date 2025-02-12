import { Account, AccountStates } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
import { TokenResult } from '../portfolio';
import { EstimateResult } from './interfaces';
export declare function estimate4337(account: Account, op: AccountOp, calls: Call[], accountStates: AccountStates, network: Network, provider: RPCProvider, feeTokens: TokenResult[], blockTag: string | number, nativeToCheck: string[], switcher: BundlerSwitcher, errorCallback: Function): Promise<EstimateResult>;
export declare function estimate(provider: RPCProvider, network: Network, account: Account, op: AccountOp, accountStates: AccountStates, nativeToCheck: string[], feeTokens: TokenResult[], errorCallback: Function, bundlerSwitcher: BundlerSwitcher, opts?: {
    calculateRefund?: boolean;
    is4337Broadcast?: boolean;
}, blockFrom?: string, blockTag?: string | number): Promise<EstimateResult>;
//# sourceMappingURL=estimate.d.ts.map