import { JsonRpcProvider, TypedDataDomain } from 'ethers';
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
import type { HardwareWalletSigningRequest } from '../../interfaces/signAccountOp';
export declare const EIP_1271_NOT_SUPPORTED_BY: string[];
export declare const AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE = "Signing an AmbireOperation is not allowed";
/**
 * Check if the typedData's intention is to target the current account
 */
export declare const isCallToSelfOrAmbireOp: (typedData: {
    primaryType: string;
    types: Record<string, unknown>;
    domain: TypedDataDomain;
}, account?: Account | null) => boolean;
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
type WithHardwareWalletSigningRequest = <T>(request: HardwareWalletSigningRequest, sign: () => Promise<T>) => Promise<T>;
export declare const doesEIP712MessageContainAddress: (message: TypedMessageUserRequest["meta"]["params"], address: string) => boolean;
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
export declare function getExecuteSignature(network: Network, accountOp: AccountOp, accountState: AccountOnchainState, signer: KeystoreSignerInterface, provider?: JsonRpcProvider): Promise<string>;
export declare function getPlainTextSignature(messageHex: PlainTextMessageUserRequest['meta']['params']['message'], network: Network, account: Account, accountState: AccountOnchainState, signer: KeystoreSignerInterface, isOG?: boolean, withHardwareWalletSigningRequest?: WithHardwareWalletSigningRequest, provider?: JsonRpcProvider): Promise<{
    signature: Hex;
    hash?: Hex;
}>;
export declare function getEIP712Signature(message: TypedMessageUserRequest['meta']['params'], account: Account, accountState: AccountOnchainState, signer: KeystoreSignerInterface, network: Network, isOG?: boolean, withHardwareWalletSigningRequest?: WithHardwareWalletSigningRequest, allowAmbireOperation?: boolean, provider?: JsonRpcProvider): Promise<{
    signature: Hex;
    hash?: Hex;
}>;
export declare function getEntryPointAuthorization(addr: AccountId, chainId: bigint, nonce: bigint): Promise<TypedMessageUserRequest['meta']['params']>;
export declare function adjustEntryPointAuthorization(entryPointSig: string): string;
export declare function getAuthorizationHash(chainId: bigint, contractAddr: Hex, nonce: bigint): Hex;
export declare function get7702Sig(chainId: bigint, nonce: bigint, implementation: Hex, signature: EIP7702Signature): EIP7702Auth;
export declare function getVerifyMessageSignature(signature: EIP7702Signature | string, account: Account, accountState: AccountOnchainState): Hex;
export declare function getAppFormatted(signature: EIP7702Signature | string, account: Account, accountState: AccountOnchainState): EIP7702Signature | Hex;
export declare const getSafeTypedData: (chainId: bigint, safeAddr: Hex, safeTx: SafeTx) => TypedMessageUserRequest["meta"]["params"];
export declare const getSafeV1TypedData: (safeAddr: Hex, safeTx: SafeTx) => TypedMessageUserRequest["meta"]["params"];
export declare const getSafeTypedDataForIsValidSignature: (chainId: bigint, safeAddr: Hex, hash: string) => TypedMessageUserRequest["meta"]["params"];
export declare const getEIP712Hash: (typedData: TypedMessageUserRequest["meta"]["params"]) => Hex;
export declare const getSafeMessageTypedData: (message: PlainTextMessageUserRequest["meta"]["params"]["message"] | TypedMessageUserRequest["meta"]["params"], chainId: bigint, safeAddr: Hex) => TypedMessageUserRequest["meta"]["params"];
export {};
//# sourceMappingURL=signMessage.d.ts.map