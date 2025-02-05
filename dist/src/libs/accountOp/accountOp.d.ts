import { AccountId } from '../../interfaces/account';
import { Key } from '../../interfaces/keystore';
import { NetworkId } from '../../interfaces/network';
import { PaymasterService } from '../erc7677/types';
import { UserOperation } from '../userOperation/types';
import { Call } from './types';
export interface GasFeePayment {
    isERC4337: boolean;
    isGasTank: boolean;
    paidBy: string;
    inToken: string;
    feeTokenNetworkId?: NetworkId;
    amount: bigint;
    simulatedGasLimit: bigint;
    gasPrice: bigint;
    maxPriorityFeePerGas?: bigint;
    isSponsored?: boolean;
}
export declare enum AccountOpStatus {
    Pending = "pending",
    BroadcastedButNotConfirmed = "broadcasted-but-not-confirmed",
    Success = "success",
    Failure = "failure",
    Rejected = "rejected",
    UnknownButPastNonce = "unknown-but-past-nonce",
    BroadcastButStuck = "broadcast-but-stuck"
}
export interface AccountOp {
    accountAddr: string;
    networkId: NetworkId;
    signingKeyAddr: Key['addr'] | null;
    signingKeyType: Key['type'] | null;
    nonce: bigint | null;
    calls: Call[];
    feeCall?: Call;
    activatorCall?: Call;
    gasLimit: number | null;
    signature: string | null;
    gasFeePayment: GasFeePayment | null;
    accountOpToExecuteBefore: AccountOp | null;
    txnId?: string;
    status?: AccountOpStatus;
    asUserOperation?: UserOperation;
    meta?: {
        entryPointAuthorization?: string;
        paymasterService?: PaymasterService;
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
export declare function callToTuple(call: Call): [string, string, string];
export declare function canBroadcast(op: AccountOp, accountIsEOA: boolean): boolean;
/**
 * Compare two AccountOps intents.
 *
 * By 'intent,' we are referring to the sender of the transaction, the network it is sent on, and the included calls.
 *
 * Since we are comparing the intents, we exclude any other properties of the AccountOps.
 */
export declare function isAccountOpsIntentEqual(accountOps1: AccountOp[], accountOps2: AccountOp[]): boolean;
export declare function getSignableCalls(op: AccountOp): [string, string, string][];
export declare function getSignableCallsForBundlerEstimate(op: AccountOp): [string, string, string][];
export declare function getSignableHash(addr: AccountId, chainId: bigint, nonce: bigint, calls: [string, string, string][]): Uint8Array;
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
//# sourceMappingURL=accountOp.d.ts.map