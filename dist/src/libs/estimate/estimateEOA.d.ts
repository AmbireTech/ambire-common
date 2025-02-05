import { JsonRpcProvider, Provider } from 'ethers';
import { Account, AccountStates } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { AccountOp } from '../accountOp/accountOp';
import { TokenResult } from '../portfolio';
import { EstimateResult } from './interfaces';
export declare function estimateEOA(account: Account, op: AccountOp, accountStates: AccountStates, network: Network, provider: JsonRpcProvider | Provider, feeTokens: TokenResult[], blockFrom: string, blockTag: string | number, errorCallback: Function): Promise<EstimateResult>;
//# sourceMappingURL=estimateEOA.d.ts.map