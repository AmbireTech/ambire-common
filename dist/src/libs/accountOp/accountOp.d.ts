import { EIP7702Auth } from '../../consts/7702';
import { AccountId } from '../../interfaces/account';
import { Key } from '../../interfaces/keystore';
import { SwapAndBridgeQuote, SwapAndBridgeSendTxRequest } from '../../interfaces/swapAndBridge';
import { PaymasterService } from '../erc7677/types';
import { UserOperation } from '../userOperation/types';
import { AccountOpStatus, Call, CallTuple } from './types';
import type { SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import type { AccountOpIdentifiedBy } from './submittedAccountOp';
export interface GasFeePayment {
    isGasTank: boolean;
    paidBy: string;
    /**
     * The account may be controlled by multiple keys. In this case, the user should
     * be able to choose which key to use.
     */
    paidByKeyType: Key['type'] | null;
    inToken: string;
    feeTokenChainId?: bigint;
    amount: bigint;
    simulatedGasLimit: bigint;
    isCustomGasLimit?: boolean;
    gasPrice: bigint;
    broadcastOption: string;
    maxPriorityFeePerGas?: bigint;
    isSponsored?: boolean;
}
export interface AccountOp {
    id: string;
    accountAddr: string;
    chainId: bigint;
    signingKeyAddr: Key['addr'] | null;
    signingKeyType: Key['type'] | null;
    nonce: bigint | null;
    eoaNonce?: bigint | null;
    calls: Call[];
    feeCall?: Call;
    activatorCall?: Call;
    gasLimit: number | null;
    signature: string | null;
    gasFeePayment: GasFeePayment | null;
    txnId?: string;
    status?: AccountOpStatus;
    asUserOperation?: UserOperation;
    signers?: {
        addr: Key['addr'];
        type: Key['type'];
    }[];
    signed?: string[];
    safeTx?: SafeMultisigTransactionResponse;
    meta?: {
        entryPointAuthorization?: string;
        paymasterService?: PaymasterService;
        swapTxn?: SwapAndBridgeSendTxRequest;
        quote?: SwapAndBridgeQuote;
        walletSendCallsVersion?: string;
        delegation?: EIP7702Auth;
        setDelegation?: boolean;
        /** Used to determine if the account op is up-to-date with the latest quote */
        fromQuoteId?: string;
        /** Used to enable the gas tank if the user is topping up */
        topUpAmount?: bigint;
        /** The operation deploys an undeployed Safe and does not require Safe owner signatures. */
        isSafeDeploy?: boolean;
        /** Allows transfer.ts-owned MAX flows to reserve the fee from the transferred token. */
        allowTransferFeeTokenSelfReserve?: boolean;
        /** Used to enable swap&bridge sponsorship */
        swapSponsorship?: {
            swapFeeInUsd: number;
            nativePrice: number;
            feeTokenPriceInUsd: number;
            feeTokenDecimals: number;
        };
        speedUp?: {
            enabled: boolean;
            /**
             * The fees of the pending transaction that is being sped up. The new fee of every
             * speed is kept at least 12.5% above these, so the network accepts the replacement.
             * `amount` is the fee that was paid, so the UI can compare it with the new one.
             * Kept here, separately from `gasFeePayment`, because `gasFeePayment` gets replaced
             * with the newly selected fee once the estimation comes in
             */
            replacedFees?: Pick<GasFeePayment, 'gasPrice' | 'maxPriorityFeePerGas' | 'amount'>;
            /**
             * When the transaction was first sent, in milliseconds. When a speed up is sped up again,
             * it's carried over from the first one, so it always refers to the very first attempt
             */
            replacedSentAt?: number;
            /** Finds the pending transaction that is being sped up, to stop if it gets processed first */
            replacedIdentifiedBy?: AccountOpIdentifiedBy;
        };
        /**
         * @deprecated No longer written or read anywhere. Used to hold the descriptor-backed
         * humanization output, persisted so activity/history/Benzin could redisplay a past op without
         * re-humanizing it. Removed because it coupled storage to the humanizer's internal, frequently
         * reshaped output type - see the persisted ERC-7730 descriptor cache (`erc7730RegistryCache`
         * in `interfaces/storage.ts`) for how this is cached now instead. Kept here, loosely typed,
         * only so the field name stays documented and isn't accidentally reused for something else.
         */
        clearSigningHumanization?: unknown[];
    };
    flags?: {
        /** Excludes it from the "failed transactions" banner and the Activity counter badge,
         *  while keeping it in the Activity history. */
        hiddenFromFailedBanner?: boolean;
    };
    /** Session ID of the dApp that initiated this accountOp, used for phishing context checks. */
    dappSessionId?: string;
}
export declare const getAccountOpNonce: (accountOp: AccountOp) => bigint | null;
/**
 * A Safe "on-chain rejection" is a transaction that only exists to occupy a pending Safe
 * nonce, replacing whatever real transaction was queued at it. Safe (the protocol) has no
 * dedicated rejection type - it's just a no-op call: a single call with no value and no data,
 * sent either to the zero address or to the Safe itself, executed as a regular call (not a
 * delegate call).
 *
 * This is the source of truth for that check, sharable by anything that has the raw call data
 * (a fetched Safe transaction, a built `AccountOp`, etc.) without needing a full `AccountOp`.
 *
 * @param calls the calls of the transaction, e.g. `accountOp.calls`
 * @param accountAddr the Safe account the transaction belongs to
 * @param operation the Safe `operation` value of the transaction (0 = Call, 1 = DelegateCall);
 * pass the `operation` from the fetched Safe transaction, or omit it for a transaction built
 * locally, which is always a plain Call
 */
export declare function isSafeRejectionCall(calls: Call[], accountAddr: string, operation?: number): boolean;
/**
 * If we want to deploy a contract, the to field of Call will actually
 * be empty (undefined). In order to simulate it in a transaction or
 * perform it using a smart account, we need to transform the call to
 * a call to the singleton
 *
 * @param call
 * @returns Call
 */
export declare function toSingletonCall(call: Call): Call;
export declare function callToTuple(call: Call): CallTuple;
export declare function canBroadcast(op: AccountOp, accountIsEOA: boolean): boolean;
export declare function getSignableCalls(op: AccountOp): CallTuple[];
export declare function getSignableHash(addr: AccountId, chainId: bigint, nonce: bigint, calls: CallTuple[]): Uint8Array;
/**
 * This function returns the hash as a Uint8Array instead of string
 * and the reason for this is the implementation that follows:
 *
 * const hash = accountOpSignableHash(op); // get the hash
 * const signature = await wallet.signMessage(hash)
 *
 * The signMessage method is an ethers method. It checks whether
 * the hash is a string or not. If it's a string, it calls
 * ethers.toUtf8Bytes to it, completing ignoring that the string
 * might actually be abi-encoded (like in our case).
 *
 * Applying ethers.toUtf8Bytes to a string is only correct if the
 * string is... a utf8 string. In our case, IT IS NOT.
 * That's why we need to wrap in with ethers.getBytes to prevent
 * the sign message from breaking it.
 *
 * If despite everything you wish to return a string instead of a Uint8Array,
 * you have to wrap the hash with ethers.getBytes each time before passing it
 * to signMessage. Also, the reverse method of ethers.getBytes is ethers.hexlify
 * if you need to transform it back.
 *
 * @param op AccountOp
 * @returns Uint8Array
 */
export declare function accountOpSignableHash(op: AccountOp, chainId: bigint): Uint8Array;
export declare const areAccountOpsEqual: (ops1: AccountOp[], ops2: AccountOp[]) => boolean;
export declare function haveCallsChanged(callsOne: AccountOp['calls'], callsTwo: AccountOp['calls']): boolean;
export declare function haveAccountOpsChanged(accountOpsOne: AccountOp[], accountOpsTwo: AccountOp[]): boolean;
//# sourceMappingURL=accountOp.d.ts.map