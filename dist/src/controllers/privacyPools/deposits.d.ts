import { PrivacyPoolsDepositAssetConfig } from '../../interfaces/privacyPools';
import { Call } from '../../libs/accountOp/types';
import { AssetRef, PhraseScopedModule, PrivacyPoolsContext } from './context';
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry';
import { PrivacyPoolsSync } from './sync';
/** A deposit from a wallet account into a Privacy Pools account. */
export type PrivacyPoolsDepositParams = AssetRef & {
    /** The Privacy Pools account receiving the funds. */
    seedId: string;
    /** The wallet account sending them. */
    accountAddr: string;
    chainId: string;
    amount: bigint;
};
/** Deposits into Privacy Pools accounts: building them, and recognising them once broadcast. */
export declare class PrivacyPoolsDeposits implements PhraseScopedModule {
    #private;
    /** Entrypoint deposit requirements per `${chainId}:${tokenAddress}` (lowercase), read once. */
    assetConfigs: {
        [key: string]: PrivacyPoolsDepositAssetConfig;
    };
    constructor(ctx: PrivacyPoolsContext, registry: PrivacyPoolsProtocolRegistry, sync: PrivacyPoolsSync);
    /**
     * The deposit calls, once the controller has checked the account, the lock and the chain.
     * See `PrivacyPoolsController.buildDepositCalls`.
     */
    buildCalls({ seedId, accountAddr, chainId, tokenAddress, amount }: PrivacyPoolsDepositParams): Promise<Call[]>;
    /** Reads the entrypoint's deposit requirements for an asset once, into `assetConfigs`. */
    loadAssetConfig(chainId: string, tokenAddress: string): Promise<PrivacyPoolsDepositAssetConfig>;
    /**
     * Marks a broadcast account op's deposits as awaiting the chain, however it was signed. Only
     * those `buildCalls` prepared are recognised, by precommitment - others are not this wallet's.
     * Nothing is persisted, as a local log would link deposits to their withdrawals.
     */
    onAccountOpBroadcast({ chainId, calls }: {
        chainId: bigint;
        calls: Call[];
    }): void;
    hasPhraseDerivedState(): boolean;
    /** Keeps its prepared and broadcast deposits, for the reason given in `clear`. */
    forgetSeed(seedId: string): void;
    /**
     * Drops the precommitments derived ahead. Prepared and broadcast deposits are kept, as one made
     * before a lock may be broadcast or land after it: it must still be recognised, and still block
     * another deposit from reusing its precommitment.
     */
    clear(): void;
}
//# sourceMappingURL=deposits.d.ts.map