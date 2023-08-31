import { TypedDataDomain } from '@ethersproject/abstract-signer'

import { Message } from '../../interfaces/userRequest'
import { Keystore } from '../../libs/keystore/keystore'
import EventEmitter from '../eventEmitter'

export class SignMessageController extends EventEmitter {
  #keystore: Keystore

  isInitialized: boolean = false

  status: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  messageToSign: Message | null = null

  signingKeyAddr: string | null = null

  // A hex-encoded 129-byte array starting with 0x.
  signature: string | null = null

  signedMessage: Message | null = null

  constructor(keystore: Keystore) {
    super()

    this.#keystore = keystore
  }

  init(messageToSign: Message) {
    if (['message', 'typedMessage'].includes(messageToSign.content.kind)) {
      this.messageToSign = messageToSign
      this.isInitialized = true
      this.emitUpdate()
    } else {
      this.emitError({
        level: 'major',
        message:
          'Ambire does not support this request format for signing messages. Please contact support if you believe could be a glitch.',
        error: new Error(
          `The ${messageToSign.content.kind} signing method is not supported by signMessageController.`
        )
      })
    }
  }

  reset() {
    this.isInitialized = false
    this.messageToSign = null
    this.signature = null
    this.signedMessage = null
    this.signingKeyAddr = null
    this.status = 'INITIAL'
    this.emitUpdate()
  }

  setSigningKeyAddr(signingKeyAddr: string) {
    this.signingKeyAddr = signingKeyAddr
    this.emitUpdate()
  }

  async sign() {
    if (!this.messageToSign) {
      return this.emitError({
        level: 'major',
        message: 'Something went wrong with the request to sign a message. Please try again.',
        error: new Error('No request to sign.')
      })
    }

    if (!this.signingKeyAddr) {
      return this.emitError({
        level: 'major',
        message: 'Please select a signing key and try again.',
        error: new Error('No request to sign.')
      })
    }

    this.status = 'LOADING'
    this.emitUpdate()

    try {
      const signer = await this.#keystore.getSigner(this.signingKeyAddr)

      if (this.messageToSign.content.kind === 'message') {
        this.signature = await signer.signMessage(this.messageToSign.content.message)
      }

      if (this.messageToSign.content.kind === 'typedMessage') {
        const { domain, types, message } = this.messageToSign.content
        // TODO: Figure out if the mismatch between the `TypedDataDomain` from
        // '@ethersproject/abstract-signer' and `TypedDataDomain` from 'ethers' is a problem
        this.signature = await signer.signTypedData(domain as TypedDataDomain, types, message)
      }

      this.signedMessage = {
        id: this.messageToSign.id,
        accountAddr: this.messageToSign.accountAddr,
        signature: this.signature,
        content: this.messageToSign.content
      }
    } catch (e) {
      const error = e instanceof Error ? e : new Error(`Signing failed. Error details: ${e}`)

      this.emitError({
        level: 'major',
        message: 'Something went wrong while signing the message. Please try again.',
        error
      })
    }
    this.status = 'DONE'
    this.emitUpdate()
  }
}
