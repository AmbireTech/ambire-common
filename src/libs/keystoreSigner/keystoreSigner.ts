/* eslint-disable new-cap */
import { Wallet } from 'ethers'

import type { TypedDataDomain, TypedDataField } from '@ethersproject/abstract-signer'
import { KeystoreSigner as KeystoreSignerInterface } from '../../interfaces/keystore'
import { Key } from '../keystore/keystore'

export class KeystoreSigner implements KeystoreSignerInterface {
  key: Key

  #privKey: string

  constructor(_key: Key, _privKey: string) {
    if (!_key) throw new Error('keystoreSigner: no key provided in constructor')

    this.key = _key
    this.#privKey = _privKey
  }

  async signRawTransaction(params: any) {
    const singer = new Wallet(this.#privKey)
    const sig = await singer.signTransaction(params)

    return sig
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    message: Record<string, any>
  ) {
    const singer = new Wallet(this.#privKey)
    const sig = await singer.signTypedData(domain, types, message)

    return sig
  }

  async signMessage(hash: string) {
    const singer = new Wallet(this.#privKey)
    const sig = await singer.signMessage(hash)

    return sig
  }
}
