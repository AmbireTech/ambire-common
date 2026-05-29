import { Transaction, TypedDataField } from 'ethers';
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
export interface KeystoreSignerInterface {
    key: Key;
    init?: (externalSignerController?: ExternalSignerController) => void;
    signRawTransaction: (txnRequest: TxnRequest) => Promise<Transaction['serialized']>;
    signTypedData: (typedMessage: TypedMessageUserRequest['meta']['params']) => Promise<string>;
    signMessage: (hex: string) => Promise<string>;
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
}
export type ScryptParams = {
    salt: string;
    N: number;
    r: number;
    p: number;
    dkLen: number;
};
export type AESEncrypted = {
    cipherType: string;
    ciphertext: string;
    iv: string;
    mac: string;
};
export type MainKeyEncryptedWithSecret = {
    id: string;
    scryptParams: ScryptParams;
    aesEncrypted: AESEncrypted;
};
export type MainKey = {
    key: Uint8Array;
    iv: Uint8Array;
};
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
export type ExternalKey = {
    addr: Account['addr'];
    type: 'trezor' | 'ledger' | 'lattice' | 'qr';
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
        [key: string]: any;
    };
};
export type StoredKey = (InternalKey & {
    privKey: string;
}) | (ExternalKey & {
    privKey: null;
});
export type KeystoreSeed = {
    id: string;
    label: string;
    seed: string;
    seedPassphrase?: string | null;
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
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
    accounts: ParsedQrImportedAccount[];
};
export type QrRequestType = 'sign-message' | 'sign-typed-data' | 'sign-transaction' | 'import-account';
export type QrRequest = {
    type: QrRequestType;
    requestId?: string;
    urType?: string;
    urCborHex?: any;
};
//# sourceMappingURL=keystore.d.ts.map