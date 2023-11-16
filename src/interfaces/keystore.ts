import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'
import { Account } from './account'
import { TypedMessage } from './userRequest'

export interface KeystoreSigner {
  // TODO: missing type, should be one of LedgerController, TrezorController, LatticeController
  init?: (controller: any) => void
  signRawTransaction: (params: any) => Promise<string>
  signTypedData: (typedMessage: TypedMessage) => Promise<string>
  signMessage: (hex: string) => Promise<string>
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

export type InternalKey = {
  addr: Account['addr']
  type: 'internal'
  meta: null
}

export type ExternalKey = {
  addr: Account['addr']
  type: 'trezor' | 'ledger' | 'lattice' | string
  meta: {
    deviceId: string
    deviceModel: string
    hdPathTemplate: HD_PATH_TEMPLATE_TYPE
    index: number
  }
}

export type StoredKey = (InternalKey & { privKey: string }) | (ExternalKey & { privKey: null })

export type KeystoreSignerType = {
  new (key: Key, privateKey?: string): KeystoreSigner
}
