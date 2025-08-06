import { Transaction, TypedDataField } from 'ethers'

import { EIP7702Auth } from '../consts/7702'
import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'
import { GasFeePayment } from '../libs/accountOp/accountOp'
import { Call } from '../libs/accountOp/types'
import { getHdPathFromTemplate } from '../utils/hdPath'
import { Account } from './account'
import { Hex } from './hex'
import { Network } from './network'
import { EIP7702Signature } from './signatures'
import { TypedMessage } from './userRequest'

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
  isUnlocked: (path?: string, expectedKeyOnThisPath?: string) => boolean
  unlock: (
    path: ReturnType<typeof getHdPathFromTemplate>,
    expectedKeyOnThisPath?: string,
    shouldOpenLatticeConnectorInTab?: boolean // Lattice specific
  ) => Promise<'ALREADY_UNLOCKED' | 'JUST_UNLOCKED'>
  unlockedPath: string
  unlockedPathKeyAddr: string
  walletSDK?: any // Either the wallet own SDK or its session, each wallet having specifics
  cleanUp: () => void // Trezor and Ledger specific
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
  signTypedData: (typedMessage: TypedMessage) => Promise<string>
  signMessage: (hex: string) => Promise<string>
  sign7702: (hex: string) => EIP7702Signature
  signTransactionTypeFour: (txnRequest: TxnRequest, eip7702Auth: EIP7702Auth) => Hex
  signingCleanup?: () => Promise<void>
}

export type ScryptParams = {
  salt: string
  N: number
  r: number
  p: number
  dkLen: number
}

export type AESEncrypted = {
  cipherType: string
  ciphertext: string
  iv: string
  mac: string
}

export type MainKeyEncryptedWithSecret = {
  id: string
  scryptParams: ScryptParams
  aesEncrypted: AESEncrypted
}

export type MainKey = {
  key: Uint8Array
  iv: Uint8Array
}

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

export type ExternalKey = {
  addr: Account['addr']
  type: 'trezor' | 'ledger' | 'lattice'
  label: string
  dedicatedToOneSA: boolean
  meta: {
    deviceId: string
    deviceModel: string
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
    index: number
    createdAt: number | null
    [key: string]: any
  }
}

export type StoredKey = (InternalKey & { privKey: string }) | (ExternalKey & { privKey: null })

export type KeystoreSeed = {
  id: string
  label: string
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
