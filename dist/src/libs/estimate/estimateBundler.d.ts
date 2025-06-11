import { EIP7702Auth } from '../../consts/7702';
import { AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { BaseAccount } from '../account/BaseAccount';
import { AccountOp } from '../accountOp/accountOp';
import { TokenResult } from '../portfolio';
import { Erc4337GasLimits } from './interfaces';
export declare function bundlerEstimate(baseAcc: BaseAccount, accountState: AccountOnchainState, op: AccountOp, network: Network, feeTokens: TokenResult[], provider: RPCProvider, switcher: BundlerSwitcher, errorCallback: Function, eip7702Auth?: EIP7702Auth): Promise<Erc4337GasLimits | Error | null>;
//# sourceMappingURL=estimateBundler.d.ts.map