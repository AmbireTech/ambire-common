import { Transaction } from 'ethers'

import { HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'
import { Call, GasFeePayment } from '../libs/accountOp/accountOp'
import { getHdPathFromTemplate } from '../utils/hdPath'
import { Account } from './account'
import { NetworkDescriptor } from './networkDescriptor'
import { TypedMessage } from './userRequest'

/**
 * Hardware wallets usually need this additional external signer controller,
 * that is app-specific (web, mobile) and is used to interact with the device.
 * (example: LedgerController, TrezorController, LatticeController)
 */
export interface ExternalSignerController {
  type: string
  hdPathTemplate: HD_PATH_TEMPLATE_TYPE
  deviceModel: string
  deviceId: string
  isUnlocked: (path?: string, expectedKeyOnThisPath?: string) => boolean
  unlock: (
    path?: ReturnType<typeof getHdPathFromTemplate>
  ) => Promise<'ALREADY_UNLOCKED' | 'JUST_UNLOCKED'>
  unlockedPath: string
  unlockedPathKeyAddr: string
  cleanUp: () => void // Trezor and Ledger specific
  // TODO: Refine the rest of the props
  isWebHID?: boolean // Ledger specific
  transport?: any // Ledger specific
  appName?: string // Lattice specific
  sdkSession?: any // Lattice specific
  creds?: any // Lattice specific
  network?: any // Lattice specific
}

export interface TxnRequest {
  to: Call['to']
  value?: Call['value']
  data: Call['data']
  chainId: NetworkDescriptor['chainId']
  nonce: number
  gasLimit: GasFeePayment['simulatedGasLimit']
  gasPrice?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
}

export interface KeystoreSigner {
  init?: (externalSignerController?: ExternalSignerController) => void
  signRawTransaction: (txnRequest: TxnRequest) => Promise<Transaction['serialized']>
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
