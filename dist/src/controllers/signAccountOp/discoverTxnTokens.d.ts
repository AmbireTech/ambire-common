import { Account, AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { BaseAccount } from '../../libs/account/BaseAccount';
import { AccountOp } from '../../libs/accountOp/accountOp';
type DiscoverTxnTokensProps = {
    account: Account;
    accountOp: AccountOp;
    accountState?: AccountOnchainState;
    baseAccount: BaseAccount;
    network: Network;
    isCurrent: () => boolean;
};
type DiscoveredAssets = {
    tokens: string[];
    nfts: [string, bigint[]][];
};
/**
 * A helper function to use in the tests only
 */
export declare const clearDiscoverTxnTokensCache: () => void;
/**
 * Goal: discover tokens that are interacting with the account during a txn
 * To do this, we use 3 methods:
 * - debug_traceCall
 * - eth_simulateV1
 * - eth_createAccessList
 * The end product of each method is similar. However, an access list can only
 * identify NFT contract addresses, while the other methods can also identify
 * token IDs from transfer logs. Different methods are supported on different
 * chains depending on the chain configs and RPC.
 * Also, some accounts require state overrides which may not be supported
 * on the specific chain. That's why we have 3 methods and rely on 1
 * having the exact support we need. The log-capable methods are preferred so
 * non-enumerable NFT token IDs can be discovered. Access-list discovery is the
 * best-effort fallback.
 * We also have a memory cache. It's simple: record the method that succeeded
 * for chain-account. The next time discoverTxnTokens is called, it will start
 * from the successful log-capable method.
 */
export declare function discoverTxnTokens({ account, accountOp, accountState, baseAccount, network, isCurrent }: DiscoverTxnTokensProps): Promise<DiscoveredAssets | null>;
export {};
//# sourceMappingURL=discoverTxnTokens.d.ts.map