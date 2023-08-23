import { UserRequest } from '../../interfaces/userRequest'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'

export class SignMessageController extends EventEmitter {
  status: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  #keystore: KeystoreController

  signingKeyAddr: string | null = null

  // A hex-encoded 129-byte array starting with 0x.
  signature: string | null = null

  #request: UserRequest | null = null

  constructor({ keystore }) {
    super()

    this.#keystore = keystore
  }

  init({ request }: { request: UserRequest }) {
    this.#request = request

    // user request? UserRequest
    // Determine if the message is typed data or personal message and set messageParams or typedDataParams
  }

  // TODO:
  reset() {
    this.signature = null
    this.status = 'INITIAL'
    this.emitUpdate()
  }

  // TODO:
  setSigningKeyAddr(signingKeyAddr: string) {}

  // TODO:
  sign() {
    if (!this.#request) {
      return this.emitError({
        level: 'major',
        message: 'Something went wrong with the request to sign a message. Please try again.',
        error: new Error('No request to sign.')
      })
    }

    if (!['message', 'typedMessage'].includes(this.#request.action.kind)) {
      return this.emitError({
        level: 'major',
        message: `Ambire does not support the requested ${
          this.#request.action.kind
        } signing method. Please contact support if you believe could be a glitch.`,
        error: new Error(`The ${this.#request.action.kind} signing method is not supported.`)
      })
    }

    this.status = 'LOADING'

    switch (this.#request.action.kind) {
      case 'message':
        return this.signMessage()
      case 'typedMessage':
        return this.signTypedMessage()
      default: {
        // TODO: Emit error.
      }
    }

    // Determine if the message is typed data or personal message and call the appropriate function
    // signMessage or signTypedData

    // save SignedMessage to Activity controller (add signed message)
  }

  // TODO:
  // Signs an EIP-191 prefixed personal message.
  signMessage() {
    // TODO: Sign personal message with keystore
    // const signature = this.#keystore.signMessage()

    // this.signature = signature
    this.status = 'DONE'
    this.emitUpdate()
  }

  // TODO:
  // Signs the EIP-712 typed data.
  signTypedMessage() {}
}
