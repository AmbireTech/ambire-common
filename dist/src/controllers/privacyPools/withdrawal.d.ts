import { PrivacyPoolsOperation } from '../../interfaces/privacyPools';
import { AssetRef, PhraseScopedModule, PrivacyPoolsContext } from './context';
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry';
import { PrivacyPoolsSync } from './sync';
/** A withdrawal from the selected Privacy Pools account to any address. */
export type PrivacyPoolsWithdrawalParams = AssetRef & {
    chainId: string;
    amount: bigint;
    recipient: string;
};
/**
 * A withdrawal handed to the bundler. `isSent` when it went through while still the current
 * operation - not after a lock or a newer one replaced it.
 */
export type PrivacyPoolsBroadcastAttempt = {
    operation: PrivacyPoolsOperation;
    isSent: boolean;
};
/**
 * Withdrawals from Privacy Pools accounts: proving one, checking it again while it waits, and
 * sending it. One at a time across phrases.
 */
export declare class PrivacyPoolsWithdrawal implements PhraseScopedModule {
    #private;
    constructor(ctx: PrivacyPoolsContext, registry: PrivacyPoolsProtocolRegistry, sync: PrivacyPoolsSync);
    /** The latest withdrawal of any phrase - see `PrivacyPoolsController.operation`. */
    get operation(): PrivacyPoolsOperation | null;
    get provingSignal(): AbortSignal | null;
    /**
     * The withdrawal half of `PrivacyPoolsController.prepareWithdrawal`, for an account already
     * checked to be available.
     */
    prepare({ seedId, chainId, tokenAddress, amount, recipient }: PrivacyPoolsWithdrawalParams & {
        seedId: string;
    }): Promise<void>;
    /**
     * Runs the proved withdrawal of `operation` again, if it is due - see
     * `PrivacyPoolsController.recheckWithdrawal`.
     */
    recheck(operation: PrivacyPoolsOperation | null): Promise<void>;
    /** Throws unless `operation` has a proved withdrawal waiting to be sent. */
    assertReadyToSend(operation: PrivacyPoolsOperation | null): asserts operation is PrivacyPoolsOperation;
    /**
     * Sends the proved withdrawal of `operation` to the bundler and waits for it. Null when it was
     * not handed over: it went stale, or a lock came while it was checked again.
     */
    broadcast(operation: PrivacyPoolsOperation): Promise<PrivacyPoolsBroadcastAttempt | null>;
    /**
     * Drops a withdrawal not sent yet: cancels one being proved and forgets a proved one, whose proof
     * is for a form no longer shown. One being sent is left to finish. Returns whether there was one.
     */
    dropUnsent(): boolean;
    /** Forgets the operation unless it is in flight. Returns whether it did. */
    dismiss(): boolean;
    hasPhraseDerivedState(): boolean;
    /** Drops the account's withdrawal unless it is being sent, which is left to finish. */
    forgetSeed(seedId: string): void;
    /**
     * Drops the operation and its proof. A withdrawal being proved is cancelled; one being sent
     * cannot be stopped, and finds itself replaced when it ends.
     */
    clear(): void;
}
//# sourceMappingURL=withdrawal.d.ts.map