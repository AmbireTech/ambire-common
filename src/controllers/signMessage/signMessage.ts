import {
  PlainTextMessage,
  SignedMessage,
  TypedMessage,
  UserRequest
} from '../../interfaces/userRequest'
import { Keystore } from '../../libs/keystore/keystore'
import EventEmitter from '../eventEmitter'

export class SignMessageController extends EventEmitter {
  status: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  #keystore: Keystore

  signingKeyAddr: string | null = null

  // A hex-encoded 129-byte array starting with 0x.
  signature: string | null = null

  #request: UserRequest | null = null

  signedMessage: SignedMessage | null = null

  constructor(keystore: Keystore) {
    super()

    this.#keystore = keystore
  }

  init({ request }: { request: UserRequest }) {
    if (['message', 'typedMessage'].includes(request.action.kind)) {
      this.#request = request
      this.emitUpdate()
    } else {
      this.emitError({
        level: 'major',
        message:
          'Ambire does not support this request format for signing messages. Please contact support if you believe could be a glitch.',
        error: new Error(
          `The ${request.action.kind} signing method is not supported by signMessageController.`
        )
      })
    }
  }

  reset() {
    this.#request = null
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
    if (!this.#request) {
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

      if (this.#request.action.kind === 'message') {
        this.signature = await signer.signMessage(this.#request.action.message)
      }

      if (this.#request.action.kind === 'typedMessage') {
        const { domain, types, message } = this.#request.action
        this.signature = await signer.signTypedData(domain as any, types, message)
      }

      this.signedMessage = {
        signature: this.signature,
        content: this.#request.action as PlainTextMessage | TypedMessage
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
