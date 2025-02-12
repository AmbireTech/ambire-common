import { JsonRpcProvider, Provider } from 'ethers';
import { Account } from '../../interfaces/account';
import { AccountOp } from '../accountOp/accountOp';
export declare function refund(account: Account, op: AccountOp, provider: JsonRpcProvider | Provider, gasUsed: bigint): Promise<bigint>;
//# sourceMappingURL=refund.d.ts.map