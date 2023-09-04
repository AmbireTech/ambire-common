/* eslint-disable new-cap */
import { TransactionRequest, Wallet } from 'ethers'

import { TypedMessage } from '../../interfaces/userRequest'
import { KeystoreSigner as KeystoreSignerInterface } from '../../interfaces/keystore'
import { Key } from '../keystore/keystore'

export class KeystoreSigner implements KeystoreSignerInterface {
  key: Key

  #signer: Wallet

  constructor(_key: Key, _privKey: string) {
    if (!_key) throw new Error('keystoreSigner: no key provided in constructor')
    if (!_privKey)
      throw new Error('keystoreSigner: no decrypted private key provided in constructor')

    this.key = _key
    this.#signer = new Wallet(_privKey)
  }

  async signRawTransaction(params: TransactionRequest) {
    const sig = await this.#signer.signTransaction(params)

    return sig
  }

  async signTypedData(typedMessage: TypedMessage) {
    // remove EIP712Domain because otherwise signTypedData throws: ambiguous primary types or unused types
    if (typedMessage.types.EIP712Domain) {
      // eslint-disable-next-line no-param-reassign
      delete typedMessage.types.EIP712Domain
    }
    // @ts-ignore
    const sig = await this.#signer.signTypedData(
      typedMessage.domain,
      typedMessage.types,
      typedMessage.message
    )

    return sig
  }

  async signMessage(hash: string | Uint8Array) {
    const sig = await this.#signer.signMessage(hash)

    return sig
  }
}
