import { JsonRpcProvider, Provider } from 'ethers';
import { Account, AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { AccountOp } from '../accountOp/accountOp';
export declare function estimateGas(account: Account, op: AccountOp, provider: Provider | JsonRpcProvider, accountState: AccountOnchainState, network: Network): Promise<bigint>;
//# sourceMappingURL=estimateGas.d.ts.map