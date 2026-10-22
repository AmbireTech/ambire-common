import { JsonRpcProvider, Transaction, TypedDataField } from 'ethers';
import { EIP7702Auth } from '../consts/7702';
import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation';
import { GasFeePayment } from '../libs/accountOp/accountOp';
import { Call } from '../libs/accountOp/types';
import { getHdPathFromTemplate } from '../utils/hdPath';
import { Account } from './account';
import { ControllerInterface } from './controller';
import { Hex } from './hex';
import { Network } from './network';
import { EIP7702Signature } from './signatures';
import { TypedMessageUserRequest } from './userRequest';
export type IKeystoreController = ControllerInterface<InstanceType<typeof import('../controllers/keystore/keystore').KeystoreController>>;
/**
 * The ExternalSignerController interface defines the structure for controllers
 * that interact with hardware wallets. Each hardware wallet type (Ledger,
 * Trezor, Lattice) will have its own implementation of this interface.
 * The interface includes methods for unlocking the device, checking if it's
 * unlocked, and cleaning up after use. It also includes properties specific to
 * each type of hardware wallet, such as the device model and ID, the path to
 * the unlocked device, and any necessary credentials.
 */
export interface ExternalSignerController {
    type: string;
    deviceModel: string;
    deviceId: string;
    isUnlocked?: (path?: string, expectedKeyOnThisPath?: string) => boolean;
    unlock?: (path: ReturnType<typeof getHdPathFromTemplate>, expectedKeyOnThisPath?: string, shouldOpenLatticeConnectorInTab?: boolean) => Promise<'ALREADY_UNLOCKED' | 'JUST_UNLOCKED'>;
    unlockedPath?: string;
    unlockedPathKeyAddr?: string;
    walletSDK?: any;
    cleanUp?: () => void;
    signingCleanup?: () => Promise<void>;
    isInitiated?: boolean;
    initialLoadPromise?: Promise<void>;
    retrieveAddresses?: (paths: string[]) => Promise<string[]>;
    connect?: (preferredDeviceId?: string) => Promise<void>;
    isWebHID?: boolean;
    singerEth?: any;
    appName?: string;
    creds?: any;
    network?: any;
    masterFingerprint?: string;
    currentRequest?: QrRequest | null;
    signingStep?: string;
    moveToResponseScan?: () => void;
    submitSignatureResponse?: (payload: string | Uint8Array) => void;
    parseAndSetAccountFromQR?: (payload: string | Uint8Array) => Promise<ParsedQrAccount>;
    nfcWalletType?: NfcWalletType;
    beginPinSession?: () => Promise<void>;
    endPinSession?: () => Promise<void>;
}
export type ExternalSignerControllers = Partial<{
    [key in Key['type']]: ExternalSignerController;
}>;
export interface TxnRequest {
    to: Call['to'];
    value?: Call['value'];
    data: Call['data'];
    chainId: Network['chainId'];
    nonce: number;
    gasLimit: GasFeePayment['simulatedGasLimit'];
    gasPrice?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    type?: number;
}
/**
 * Per-request context passed to {@link KeystoreSignerInterface.signMessage}
 * and {@link KeystoreSignerInterface.signTypedData}.
 *
 * EOA-style signers (Ledger, Trezor, Lattice, QR, internal keystore) can
 * ignore this entirely — their output is chain-agnostic (ECDSA over the
 * EIP-191 / EIP-712 hash). Smart-account signers whose signatures are
 * verified on-chain via ERC-1271 / ERC-6492 (currently PQ1) need to know
 * which chain the verifier will run on so they can:
 *   1) decide whether to emit a bare ERC-1271 wrapper or an ERC-6492
 *      deploy-and-verify blob (based on `eth_getCode(sender)`), and
 *   2) tell the device which chainId the signed message is bound to.
 */
export interface SignMessageContext {
    chainId: bigint;
    provider: JsonRpcProvider;
}
export interface KeystoreSignerInterface {
    key: Key;
    init?: (externalSignerController?: ExternalSignerController) => void;
    signRawTransaction: (txnRequest: TxnRequest) => Promise<Transaction['serialized']>;
    signTypedData: (typedMessage: TypedMessageUserRequest['meta']['params'], ctx?: SignMessageContext) => Promise<string>;
    signMessage: (hex: string, ctx?: SignMessageContext) => Promise<string>;
    sign7702: ({ chainId, contract, nonce }: {
        chainId: bigint;
        contract: Hex;
        nonce: bigint;
    }) => Promise<EIP7702Signature>;
    signTransactionTypeFour: ({ txnRequest, eip7702Auth }: {
        txnRequest: TxnRequest;
        eip7702Auth: EIP7702Auth;
    }) => Promise<Hex>;
    getEncryptionPublicKey?: () => Promise<string>;
    decrypt?: (encryptedData: string) => string;
    signingCleanup?: () => Promise<void>;
    /**
     * Smart-contract-account-only signers (currently PQ1) cannot produce a
     * raw EOA transaction. Instead they take the AccountOp's calls list,
     * package them into the signer's native transaction shape (e.g. an
     * ERC-4337 UserOperation), sign on-device, and broadcast — returning the
     * resulting userOpHash + the nonce the op was submitted with, so the
     * caller can track inclusion and per-op success the same way as any
     * other bundler broadcast (`identifiedBy: { type: 'UserOperation' }`).
     * Implementations bypass Ambire's relayer/bundler stack entirely, but
     * MUST bind the broadcast fees to the user-approved `gasFeePayment` —
     * the user pays what the fee UI showed, not what the signer's own
     * pipeline would pick.
     */
    broadcastAccountOp?: (params: {
        chainId: bigint;
        provider: JsonRpcProvider;
        calls: {
            to: Call['to'];
            value: Call['value'];
            data: Call['data'];
        }[];
        gasFeePayment: {
            gasPrice: bigint;
            maxPriorityFeePerGas?: bigint;
        };
    }) => Promise<{
        userOpHash: Hex;
        nonce: bigint;
    }>;
}
export type ScryptParams = {
    salt: string;
    N: number;
    r: number;
    p: number;
    dkLen: number;
};
export type AESEncryptedOld = {
    cipherType?: 'aes-128-ctr';
    ciphertext: string;
    iv: string;
    mac: string;
};
export type AESGCMEncrypted = {
    cipherType: 'AES-GCM';
    ciphertext: string;
    iv: string;
};
export type KeystoreEncryptedPayload = string | AESGCMEncrypted;
export type MainKeyEncryptedWithSecret = {
    id: string;
    scryptParams: ScryptParams;
    aesEncrypted: AESEncryptedOld | AESGCMEncrypted;
};
export type MainKeyOld = {
    key: Uint8Array;
    iv: Uint8Array;
};
export type MainKey = CryptoKey;
export type Key = (InternalKey | ExternalKey) & {
    isExternallyStored: boolean;
};
export declare const standardSigningOnlyPriv = "0x0000000000000000000000000000000000000000000000000000000000000001";
export declare const dedicatedToOneSAPriv = "0x0000000000000000000000000000000000000000000000000000000000000002";
export type InternalKey = {
    addr: Account['addr'];
    type: 'internal';
    label: string;
    dedicatedToOneSA: boolean;
    meta: {
        createdAt: number | null;
        fromSeedId?: string;
        [key: string]: any;
    };
};
export type QrWalletType = 'keystone' | 'imtoken' | 'keycard';
export type QrProtocolType = 'ur' | 'airgap';
export type NfcWalletType = 'keycard';
export type ExternalKey = {
    addr: Account['addr'];
    type: 'trezor' | 'onekey' | 'ledger' | 'lattice' | 'qr' | 'nfc' | 'pq1';
    label: string;
    dedicatedToOneSA: boolean;
    meta: {
        deviceId: string;
        deviceModel: string;
        hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
        index: number;
        createdAt: number | null;
        qrWalletType?: QrWalletType;
        qrProtocol?: QrProtocolType;
        masterFingerprint?: string;
        nfcWalletType?: NfcWalletType;
        [key: string]: any;
    };
};
export type StoredKey = (InternalKey & {
    privKey: KeystoreEncryptedPayload;
}) | (ExternalKey & {
    privKey: null;
});
export type KeystoreSeed = {
    id: string;
    label: string;
    seed: string;
    seedPassphrase?: string | null;
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
    notBackedUp?: boolean;
};
export type StoredKeystoreSeed = Omit<KeystoreSeed, 'seed' | 'seedPassphrase'> & {
    /**
     * We store the seed entropy (not the seed phrase string) as an encrypted payload
     */
    seed: KeystoreEncryptedPayload;
    seedPassphrase?: KeystoreEncryptedPayload | null;
};
export type KeystoreTempSeed = {
    seed: string;
    seedPassphrase?: string | null;
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
    notBackedUp?: boolean;
};
export type KeystoreSignerType = {
    new (key: Key, privateKey?: string): KeystoreSignerInterface;
};
/**
 * The keys that are ready to be added to the user's keystore (by the Main Controller).
 * They are needed as an intermediate step during the accounts import flow
 * (for the accounts that were just imported by the AccountPicker Controller).
 */
export type ReadyToAddKeys = {
    internal: {
        addr: InternalKey['addr'];
        label: string;
        type: InternalKey['type'];
        privateKey: string;
        dedicatedToOneSA: InternalKey['dedicatedToOneSA'];
        meta: InternalKey['meta'];
    }[];
    external: {
        addr: ExternalKey['addr'];
        label: string;
        type: ExternalKey['type'];
        dedicatedToOneSA: Key['dedicatedToOneSA'];
        meta: ExternalKey['meta'];
    }[];
};
export type KeyPreferences = {
    label: string;
};
export type EIP712Types = Record<string, TypedDataField[]>;
export type ParsedQrImportedAccount = {
    addr?: string;
    xpub?: string;
    index?: number;
    hdPath?: string;
};
export type ParsedQrAccount = {
    masterFingerprint?: string;
    walletType?: QrWalletType;
    deviceModel?: string;
    deviceId?: string;
    hdPath?: string;
    /**
     * The path the wallet says its addresses sit at, relative to the exported key and
     * with a `*` where the address index goes (e.g. `0/*` for the BIP44 standard chain,
     * `*` for the Ledger Legacy path). Optional in the QR payload - a wallet that omits
     * it leaves no way to tell which of the two it exported.
     */
    childrenPath?: string;
    accounts: ParsedQrImportedAccount[];
};
export type QrRequestType = 'sign-message' | 'sign-typed-data' | 'sign-transaction' | 'import-account';
export type QrRequest = {
    type: QrRequestType;
    requestId?: string;
    urType?: string;
    urCborHex?: any;
};
/**
 * The outcome of re-checking a keystore secret without changing the lock state, used by the
 * signing authentication prompt.
 */
export type SigningAuthResult = {
    status: 'success' | 'failed';
    /** The user facing reason the check failed, `null` on success. */
    error: string | null;
    /**
     * Counts up per check. Two checks in a row otherwise produce an identical result, which the
     * UI's reconciled state hands back as the same reference - so the second one goes unnoticed.
     */
    id: number;
};
//# sourceMappingURL=keystore.d.ts.map