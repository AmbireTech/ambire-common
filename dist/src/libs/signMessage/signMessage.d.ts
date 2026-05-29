import { JsonRpcProvider } from 'ethers';
import { CallTuple } from '../accountOp/types';
import { MessageTypes } from '@metamask/eth-sig-util';
import { EIP7702Auth } from '../../consts/7702';
import { Account, AccountCreation, AccountId, AccountOnchainState } from '../../interfaces/account';
import { Hex } from '../../interfaces/hex';
import { KeystoreSignerInterface } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { SafeTx } from '../../interfaces/safe';
import { EIP7702Signature } from '../../interfaces/signatures';
import { PlainTextMessageUserRequest, TypedMessageUserRequest } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
import { PackedUserOperation } from '../userOperation/types';
export declare const EIP_1271_NOT_SUPPORTED_BY: string[];
/**
 * For Unprotected signatures, we need to append 00 at the end
 * for ambire to recognize it
 */
export declare const wrapUnprotected: (signature: string) => string;
/**
 * For EIP-712 signatures, we need to append 01 at the end
 * for ambire to recognize it.
 * For v1 contracts, we do ETH sign at the 01 slot, which we'll
 * call standard from now on
 */
export declare const wrapStandard: (signature: string) => string;
/**
 * For v2 accounts acting as signers, we need to append the v2 wallet
 * addr that's the signer and a 02 mode at the end to indicate it's a wallet:
 * {sig+mode}{wallet_32bytes}{mode}
 */
export declare const wrapWallet: (signature: string, walletAddr: string) => string;
interface AmbireReadableOperation {
    addr: Hex;
    chainId: bigint;
    nonce: bigint;
    calls: {
        to: Hex;
        value: bigint;
        data: Hex;
    }[];
}
export declare const adaptTypedMessageForMetaMaskSigUtil: (typedMessage: TypedMessageUserRequest["meta"]["params"]) => {
    types: MessageTypes;
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: string;
        salt: ArrayBuffer;
    };
    message: Record<string, any>;
    primaryType: keyof Record<string, Array<import("ethers").TypedDataField>>;
};
export declare const getAmbireReadableTypedData: (chainId: bigint, verifyingAddr: string, v1Execute: AmbireReadableOperation) => TypedMessageUserRequest["meta"]["params"];
/**
 * Return the typed data for EIP-712 sign
 */
export declare const getTypedData: (chainId: bigint, verifyingAddr: string, msgHash: string) => TypedMessageUserRequest["meta"]["params"];
/**
 * Return the typed data for EIP-712 sign
 */
export declare const get7702UserOpTypedData: (chainId: bigint, txns: CallTuple[], packedUserOp: PackedUserOperation, userOpHash: string) => TypedMessageUserRequest["meta"]["params"];
/**
 * Produce EIP6492 signature for Predeploy Contracts
 *
 * More info: https://eips.ethereum.org/EIPS/eip-6492
 *
 * @param {string} signature - origin ERC-1271 signature
 * @param {object} account
 * @returns {string} - EIP6492 signature
 */
export declare const wrapCounterfactualSign: (signature: string, creation: AccountCreation) => string;
type Props = {
    provider: JsonRpcProvider;
    signer: string;
    signature: string | Uint8Array;
} & ({
    message: string | Uint8Array;
    typedData?: never;
    authorization?: never;
} | {
    typedData: TypedMessageUserRequest['meta']['params'];
    message?: never;
    authorization?: never;
} | {
    message?: never;
    typedData?: never;
    authorization: Hex;
});
/**
 * Verifies the signature of a message using the provided signer and signature
 * via a "magic" universal validator contract using the provided provider to
 * verify the signature on-chain. The contract deploys itself within the
 * `eth_call`, tries to verify the signature using ERC-6492, ERC-1271, and
 * `ecrecover`, and returns the value to the function.
 *
 * Note: you only need to pass one of: `message` or `typedData`
 */
export declare function verifyMessage({ provider, signer, signature, message, authorization, typedData }: Props): Promise<boolean>;
export declare function getExecuteSignature(network: Network, accountOp: AccountOp, accountState: AccountOnchainState, signer: KeystoreSignerInterface): Promise<string>;
export declare function getPlainTextSignature(messageHex: PlainTextMessageUserRequest['meta']['params']['message'], network: Network, account: Account, accountState: AccountOnchainState, signer: KeystoreSignerInterface, isOG?: boolean): Promise<{
    signature: Hex;
    hash?: Hex;
}>;
export declare function getEIP712Signature(message: TypedMessageUserRequest['meta']['params'], account: Account, accountState: AccountOnchainState, signer: KeystoreSignerInterface, network: Network, isOG?: boolean): Promise<{
    signature: Hex;
    hash?: Hex;
}>;
export declare function getEntryPointAuthorization(addr: AccountId, chainId: bigint, nonce: bigint): Promise<TypedMessageUserRequest['meta']['params']>;
export declare function adjustEntryPointAuthorization(entryPointSig: string): string;
export declare function getAuthorizationHash(chainId: bigint, contractAddr: Hex, nonce: bigint): Hex;
export declare function get7702Sig(chainId: bigint, nonce: bigint, implementation: Hex, signature: EIP7702Signature): EIP7702Auth;
export declare function getVerifyMessageSignature(signature: EIP7702Signature | string, account: Account, accountState: AccountOnchainState): Hex;
export declare function getAppFormatted(signature: EIP7702Signature | string, account: Account, accountState: AccountOnchainState): EIP7702Signature | Hex;
/**
 * Tries to convert an input (from a dapp) to a hex string
 */
export declare const toPersonalSignHex: (input: string | Uint8Array | Hex) => Hex;
export declare const getSafeTypedData: (chainId: bigint, safeAddr: Hex, safeTx: SafeTx) => TypedMessageUserRequest["meta"]["params"];
export declare const getSafeV1TypedData: (safeAddr: Hex, safeTx: SafeTx) => TypedMessageUserRequest["meta"]["params"];
export declare const getSafeTypedDataForIsValidSignature: (chainId: bigint, safeAddr: Hex, hash: string) => TypedMessageUserRequest["meta"]["params"];
export {};
//# sourceMappingURL=signMessage.d.ts.map