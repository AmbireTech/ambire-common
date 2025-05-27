import { Account, AccountOnchainState } from '../../interfaces/account';
import { Hex } from '../../interfaces/hex';
import { TxnRequest } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
export declare const BROADCAST_OPTIONS: {
    bySelf: string;
    bySelf7702: string;
    byBundler: string;
    byRelayer: string;
    byOtherEOA: string;
    delegation: string;
};
export declare function getByOtherEOATxnData(account: Account, op: AccountOp, accountState: AccountOnchainState): {
    to: Hex;
    value: bigint;
    data: Hex;
};
export declare function getTxnData(account: Account, op: AccountOp, accountState: AccountOnchainState, provider: RPCProvider, broadcastOption: string, nonce: number, call?: Call): Promise<{
    to: Hex;
    value: bigint;
    data: Hex;
    gasLimit?: bigint;
}>;
export declare function buildRawTransaction(account: Account, op: AccountOp, accountState: AccountOnchainState, provider: RPCProvider, network: Network, nonce: number, broadcastOption: string, call?: Call): Promise<TxnRequest>;
//# sourceMappingURL=broadcast.d.ts.map