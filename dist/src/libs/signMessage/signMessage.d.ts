import { JsonRpcProvider, TypedDataDomain, TypedDataField } from 'ethers';
import { Account, AccountCreation, AccountId, AccountOnchainState } from '../../interfaces/account';
import { Hex } from '../../interfaces/hex';
import { KeystoreSigner } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { TypedMessage } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
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
export declare const getAmbireReadableTypedData: (chainId: bigint, verifyingAddr: string, v1Execute: AmbireReadableOperation) => TypedMessage;
/**
 * Return the typed data for EIP-712 sign
 */
export declare const getTypedData: (chainId: bigint, verifyingAddr: string, msgHash: string) => TypedMessage;
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
export declare function mapSignatureV(sigRaw: string): string;
type Props = {
    network?: Network;
    provider?: JsonRpcProvider;
    signer?: string;
    signature: string | Uint8Array;
    message?: string | Uint8Array;
    typedData?: {
        domain: TypedDataDomain;
        types: Record<string, Array<TypedDataField>>;
        message: Record<string, any>;
    };
    finalDigest?: string;
};
/**
 * Verifies the signature of a message using the provided signer and signature
 * via a "magic" universal validator contract using the provided provider to
 * verify the signature on-chain. The contract deploys itself within the
 * `eth_call`, tries to verify the signature using ERC-6492, ERC-1271, and
 * `ecrecover`, and returns the value to the function.
 *
 * Note: you only need to pass one of: typedData, finalDigest, message
 */
export declare function verifyMessage({ network, provider, signer, signature, message, typedData, finalDigest }: (Required<Pick<Props, 'message'>> | Required<Pick<Props, 'typedData'>> | Required<Pick<Props, 'finalDigest'>>) & Props): Promise<boolean>;
export declare function getExecuteSignature(network: Network, accountOp: AccountOp, accountState: AccountOnchainState, signer: KeystoreSigner): Promise<string>;
export declare function getPlainTextSignature(message: string | Uint8Array, network: Network, account: Account, accountState: AccountOnchainState, signer: KeystoreSigner): Promise<string>;
export declare function getEIP712Signature(message: TypedMessage, account: Account, accountState: AccountOnchainState, signer: KeystoreSigner, network: Network): Promise<string>;
export declare function getEntryPointAuthorization(addr: AccountId, chainId: bigint, nonce: bigint): Promise<TypedMessage>;
export declare function adjustEntryPointAuthorization(signature: string): string;
export {};
//# sourceMappingURL=signMessage.d.ts.map