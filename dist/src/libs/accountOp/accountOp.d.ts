import { SafeMultisigTransactionResponse } from '@safe-global/types-kit';
import { EIP7702Auth } from '../../consts/7702';
import { AccountId } from '../../interfaces/account';
import { Key } from '../../interfaces/keystore';
import { SwapAndBridgeQuote, SwapAndBridgeSendTxRequest } from '../../interfaces/swapAndBridge';
import { PaymasterService } from '../erc7677/types';
import { UserOperation } from '../userOperation/types';
import { AccountOpStatus, Call, CallTuple } from './types';
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
        /** Allows transfer.ts-owned MAX flows to reserve the fee from the transferred token. */
        allowTransferFeeTokenSelfReserve?: boolean;
        /** Used to enable swap&bridge sponsorship */
        swapSponsorship?: {
            swapFeeInUsd: number;
            nativePrice: number;
            fromTokenPriceInUsd: number;
            fromTokenDecimals: number;
        };
        speedUp?: {
            enabled: boolean;
        };
    };
    flags?: {
        hideActivityBanner?: boolean;
    };
}
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