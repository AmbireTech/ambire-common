import { Transaction, TypedDataField } from 'ethers'

import { EIP7702Auth } from '../consts/7702'
import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'
// TODO: Handle better to prevent dep cycle
import { GasFeePayment } from '../libs/accountOp/accountOp'
// TODO: Handle better to prevent dep cycle
import { Call } from '../libs/accountOp/types'
import { getHdPathFromTemplate } from '../utils/hdPath'
import { Account } from './account'
import { ControllerInterface } from './controller'
import { Hex } from './hex'
import { Network } from './network'
import { EIP7702Signature } from './signatures'
// TODO: Handle better to prevent dep cycle
import { TypedMessageUserRequest } from './userRequest'

export type IKeystoreController = ControllerInterface<
  InstanceType<typeof import('../controllers/keystore/keystore').KeystoreController>
>

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
  type: string
  deviceModel: string
  deviceId: string
  isUnlocked?: (path?: string, expectedKeyOnThisPath?: string) => boolean
  unlock?: (
    path: ReturnType<typeof getHdPathFromTemplate>,
    expectedKeyOnThisPath?: string,
    shouldOpenLatticeConnectorInTab?: boolean // Lattice specific
  ) => Promise<'ALREADY_UNLOCKED' | 'JUST_UNLOCKED'>
  unlockedPath?: string
  unlockedPathKeyAddr?: string
  walletSDK?: any // Either the wallet own SDK or its session, each wallet having specifics
  cleanUp?: () => void // Trezor and Ledger specific
  signingCleanup?: () => Promise<void> // Trezor and Ledger specific
  isInitiated?: boolean // Trezor specific
  initialLoadPromise?: Promise<void> // Trezor specific
  retrieveAddresses?: (paths: string[]) => Promise<string[]> // Ledger specific
  // TODO: Refine the rest of the props
  isWebHID?: boolean // Ledger specific
  singerEth?: any // Ledger specific
  appName?: string // Lattice specific
  creds?: any // Lattice specific
  network?: any // Lattice specific
  masterFingerprint?: string // Optional for some wallets, but can be used for additional info
  currentRequest?: QrRequest | null // Qr based specific
  signingStep?: string //Qr based specific
  moveToResponseScan?: () => void //Qr based specific
  submitSignatureResponse?: (payload: string | Uint8Array) => void //Qr based specific
  parseAndSetAccountFromQR?: (payload: string | Uint8Array) => Promise<ParsedQrAccount> //Qr based specific
}
export type ExternalSignerControllers = Partial<{ [key in Key['type']]: ExternalSignerController }>

export interface TxnRequest {
  to: Call['to']
  value?: Call['value']
  data: Call['data']
  chainId: Network['chainId']
  nonce: number
  gasLimit: GasFeePayment['simulatedGasLimit']
  gasPrice?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  type?: number
}

export interface KeystoreSignerInterface {
  key: Key
  init?: (externalSignerController?: ExternalSignerController) => void
  signRawTransaction: (txnRequest: TxnRequest) => Promise<Transaction['serialized']>
  signTypedData: (typedMessage: TypedMessageUserRequest['meta']['params']) => Promise<string>
  signMessage: (hex: string) => Promise<string>
  sign7702: ({
    chainId,
    contract,
    nonce
  }: {
    chainId: bigint
    contract: Hex
    nonce: bigint
  }) => Promise<EIP7702Signature>
  signTransactionTypeFour: ({
    txnRequest,
    eip7702Auth
  }: {
    txnRequest: TxnRequest
    eip7702Auth: EIP7702Auth
  }) => Promise<Hex>
  getEncryptionPublicKey?: () => Promise<string> // base64 string
  decrypt?: (encryptedData: string) => string // plain text
  signingCleanup?: () => Promise<void>
}

export type ScryptParams = {
  salt: string
  N: number
  r: number
  p: number
  dkLen: number
}

export type AESEncryptedOld = {
  cipherType?: 'aes-128-ctr'
  ciphertext: string
  iv: string
  mac: string
}

export type AESGCMEncrypted = {
  cipherType: 'AES-GCM'
  ciphertext: string
  iv: string
}

export type KeystoreEncryptedPayload = string | AESGCMEncrypted

export type MainKeyEncryptedWithSecret = {
  id: string
  scryptParams: ScryptParams
  aesEncrypted: AESEncryptedOld | AESGCMEncrypted
}

export type MainKeyOld = {
  key: Uint8Array
  iv: Uint8Array
}

export type MainKey = CryptoKey

export type Key = (InternalKey | ExternalKey) & { isExternallyStored: boolean }

export const standardSigningOnlyPriv =
  '0x0000000000000000000000000000000000000000000000000000000000000001'
export const dedicatedToOneSAPriv =
  '0x0000000000000000000000000000000000000000000000000000000000000002'

export type InternalKey = {
  addr: Account['addr']
  type: 'internal'
  label: string
  dedicatedToOneSA: boolean
  meta: {
    createdAt: number | null
    fromSeedId?: string
    [key: string]: any
  }
}

export type QrWalletType = 'keystone' | 'imtoken' | 'keycard' // We can add more supported QR wallets here in the future, and they will be handled by the QrProtocolAdapter implementations, which are specific to each wallet type
export type QrProtocolType = 'ur' | 'airgap'

export type ExternalKey = {
  addr: Account['addr']
  type: 'trezor' | 'ledger' | 'lattice' | 'qr'
  label: string
  dedicatedToOneSA: boolean
  meta: {
    deviceId: string
    deviceModel: string
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
    index: number
    createdAt: number | null

    qrWalletType?: QrWalletType
    qrProtocol?: QrProtocolType
    masterFingerprint?: string // BIP32 root fingerprint used to identify/verify the originating hardware wallet account set in QR flows
    [key: string]: any
  }
}

export type StoredKey =
  | (InternalKey & { privKey: KeystoreEncryptedPayload })
  | (ExternalKey & { privKey: null })

export type KeystoreSeed = {
  id: string
  label: string
  seed: string
  seedPassphrase?: string | null
  hdPathTemplate: HD_PATH_TEMPLATE_TYPE
}

export type StoredKeystoreSeed = Omit<KeystoreSeed, 'seed' | 'seedPassphrase'> & {
  /**
   * We store the seed entropy (not the seed phrase string) as an encrypted payload
   */
  seed: KeystoreEncryptedPayload
  seedPassphrase?: KeystoreEncryptedPayload | null
}

export type KeystoreTempSeed = {
  seed: string
  seedPassphrase?: string | null
  hdPathTemplate: HD_PATH_TEMPLATE_TYPE
}

export type KeystoreSignerType = {
  new (key: Key, privateKey?: string): KeystoreSignerInterface
}

/**
 * The keys that are ready to be added to the user's keystore (by the Main Controller).
 * They are needed as an intermediate step during the accounts import flow
 * (for the accounts that were just imported by the AccountPicker Controller).
 */
export type ReadyToAddKeys = {
  internal: {
    addr: InternalKey['addr']
    label: string
    type: InternalKey['type']
    privateKey: string
    dedicatedToOneSA: InternalKey['dedicatedToOneSA']
    meta: InternalKey['meta']
  }[]
  external: {
    addr: ExternalKey['addr']
    label: string
    type: ExternalKey['type']
    dedicatedToOneSA: Key['dedicatedToOneSA']
    meta: ExternalKey['meta']
  }[]
}

export type KeyPreferences = {
  label: string
}

export type EIP712Types = Record<string, TypedDataField[]>

export type ParsedQrImportedAccount = {
  addr?: string
  xpub?: string
  index?: number
  hdPath?: string
}

export type ParsedQrAccount = {
  masterFingerprint?: string
  walletType?: QrWalletType
  deviceModel?: string
  deviceId?: string
  hdPath?: string // For wallets that don't provide the hdPath on each account, but only a general one for the whole export (like Keystone)
  // BC-UR crypto-hdkey children keypath pattern (e.g. "*/*" for BIP44, "*" for Ledger Legacy).
  childrenPath?: string
  accounts: ParsedQrImportedAccount[]
}

export type QrRequestType =
  | 'sign-message'
  | 'sign-typed-data'
  | 'sign-transaction'
  | 'import-account'

export type QrRequest = {
  type: QrRequestType
  requestId?: string
  urType?: string
  urCborHex?: any
}
