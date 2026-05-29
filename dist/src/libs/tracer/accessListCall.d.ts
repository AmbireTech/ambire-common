import { RPCProvider } from '../../interfaces/provider';
import { Account, AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { BaseAccount } from '../account/BaseAccount';
import { AccountOp } from '../accountOp/accountOp';
export declare function getSimulateTxnAccessor(version?: string): string | null;
export declare function getShouldUseAccessListCall(account: Account, needsStateOverride: boolean): boolean;
/**
 * We cannot use execTransaction for the access list call as it would require signatures for the transaction
 * (which we don't have at the point of simulation). Instead, we can use the simulate function of the SimulateTxAccessor contract,
 * which executes the transaction but reverts at the end, allowing us to trace it without needing signatures.
 *
 * The only downside is that there are multiple deployments of the contract, which is not that bad as we
 * can easily select the right one based on the Safe version and fall back to debug_traceCall if the version is not supported
 * All deployments: https://github.com/safe-global/safe-deployments/blob/main/src/deployments.ts
 */
export declare function getSafeAccessListCallParams(baseAcc: BaseAccount, op: AccountOp, accountState: AccountOnchainState): {
    to: string;
    value: number;
    data: string;
    from: string;
};
/**
 * Parses an access list and extracts unique contract addresses
 */
export declare function parseAccessList(accessList: Array<{
    address: string;
    storageKeys: string[];
}> | undefined): string[];
export declare function sendCreateAccessList(provider: RPCProvider, params: {
    to: string;
    value: number | string;
    data: string;
    from: string;
}, network: Network, 
/**
 * State override was added in 2025 but is not yet widely supported, so it shouldn't be used
 * https://github.com/ethereum/go-ethereum/issues/27630
 */
stateOverride?: any): Promise<any>;
/**
 * Uses eth_createAccessList to discover contract addresses accessed during transaction execution.
 * Traces all calls in the AccountOp and merges the discovered addresses.
 */
export declare function createAccessListCall(baseAcc: BaseAccount, op: AccountOp, network: Network, accountState: AccountOnchainState): Promise<string[]>;
//# sourceMappingURL=accessListCall.d.ts.map