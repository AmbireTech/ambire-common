import { UserRequest } from '../../interfaces/userRequest'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'

export class SignMessageController extends EventEmitter {
  status: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  #keystore: KeystoreController

  signingKeyAddr: string | null = null

  // TODO: define type
  messageParams = null

  // TODO: define type
  typedDataParams = null

  // TODO: define type
  signature: string | null = null

  constructor({ keystore }) {
    super()

    this.#keystore = keystore
  }

  init({ request }: { request: UserRequest }) {
    // user request? UserRequest
    // Determine if the message is typed data or personal message and set messageParams or typedDataParams
  }

  // TODO:
  reset() {}

  // TODO:
  setSigningKeyAddr(signingKeyAddr: string) {}

  // TODO:
  sign() {
    this.status = 'LOADING'

    // Determine if the message is typed data or personal message and call the appropriate function
    // signMessage or signTypedData

    // save SignedMessage to Activity controller (add signed message)
  }

  // TODO:
  signMessage() {
    // this.keystore

    // this.signature = signature
    this.emitUpdate()
  }

  // TODO:
  signTypedData() {}
}
