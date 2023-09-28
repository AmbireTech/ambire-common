import { Account } from './account'
import { TypedMessage } from './userRequest'

export interface KeystoreSigner {
  signRawTransaction: (params: any) => Promise<string>
  signTypedData: (typedMessage: TypedMessage) => Promise<string>
  signMessage: (hash: string | Uint8Array) => Promise<string>
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

export type Key = Omit<StoredKey, 'privKey'> & { isExternallyStored: boolean }

export type StoredKey =
  | {
      addr: Account['addr']
      type: 'internal'
      label: string
      privKey: string
      meta: null
    }
  | {
      addr: Account['addr']
      type: 'trezor' | 'ledger' | 'lattice'
      label: string
      privKey: null
      meta: { model: string; hdPath: string }
    }

export type KeystoreSignerType = {
  new (key: Key, privateKey?: string): KeystoreSigner
}
