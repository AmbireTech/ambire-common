import { UserRequest } from '../../interfaces/userRequest'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'

export class SignMessageController extends EventEmitter {
  status: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  #keystore: KeystoreController

  signingKeyAddr: string | null = null

  // TODO: define type
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
  reset() {}

  // TODO:
  setSigningKeyAddr(signingKeyAddr: string) {}

  // TODO:
  sign() {
    if (!this.#request) {
      // TODO: emit error
      return
    }

    this.status = 'LOADING'

    switch (this.#request.action.kind) {
      case 'call':
        return this.signCall()
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

  signCall() {}

  // TODO:
  signMessage() {
    // this.#keystore

    // this.signature = signature
    this.emitUpdate()
  }

  // TODO:
  signTypedMessage() {}
}
