import { IActivityController } from '../interfaces/activity';
import { RPCProvider } from '../interfaces/provider';
import { AccountOp } from '../libs/accountOp/accountOp';
export declare function getRelayerNonce(activity: IActivityController, op: AccountOp, provider: RPCProvider): Promise<bigint>;
//# sourceMappingURL=nonce.d.ts.map