import { Account, AccountStates } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { AccountOp } from '../accountOp/accountOp';
import { TokenResult } from '../portfolio';
import { EstimateResult } from './interfaces';
export declare function bundlerEstimate(account: Account, accountStates: AccountStates, op: AccountOp, network: Network, feeTokens: TokenResult[], provider: RPCProvider, switcher: BundlerSwitcher, errorCallback: Function): Promise<EstimateResult>;
//# sourceMappingURL=estimateBundler.d.ts.map