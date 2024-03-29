/* eslint-disable new-cap */
import { getBytes, isHexString, TransactionRequest, Wallet } from 'ethers'

import { Key, KeystoreSigner as KeystoreSignerInterface } from '../../interfaces/keystore'
import { TypedMessage } from '../../interfaces/userRequest'

export class KeystoreSigner implements KeystoreSignerInterface {
  key: Key

  #signer: Wallet

  constructor(_key: Key, _privKey?: string) {
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

  async signMessage(hex: string): Promise<string> {
    // interface implementation expects a hex number
    // if something different is passed, we have two options:
    // * throw an error
    // * convert to hex
    // converting to hex is not so straightforward, though
    // you might do ethers.toUtf8Bytes() if it's a string
    // or you might do ethers.toBeHex() for a number with a specific length
    // or you might do ethers.hexlify() if you don't care
    // therefore, it's the job of the client to think what he wants
    // to pass. Throwing an error here might save debuging hours
    if (!isHexString(hex)) {
      throw new Error('Keystore signer, signMessage: passed value is not a hex')
    }

    return this.#signer.signMessage(getBytes(hex))
  }

  async sendTransaction(transaction: TransactionRequest) {
    const transactionRes = await this.#signer.sendTransaction(transaction)

    return transactionRes
  }
}
