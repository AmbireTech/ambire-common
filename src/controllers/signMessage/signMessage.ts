import { TypedDataDomain } from '@ethersproject/abstract-signer'

import { Account, AccountCreation, AccountStates } from '../../interfaces/account'
import { Message } from '../../interfaces/userRequest'
import { Keystore } from '../../libs/keystore/keystore'
import { mapSignatureV, wrapSignature } from '../../libs/signMessage/signMessage'
import EventEmitter from '../eventEmitter'

export class SignMessageController extends EventEmitter {
  #keystore: Keystore

  #accounts: Account[] | null = null

  #accountStates: AccountStates | null = null

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

  init({
    messageToSign,
    accounts,
    accountStates
  }: {
    messageToSign: Message
    accounts: Account[]
    accountStates: AccountStates
  }) {
    if (['message', 'typedMessage'].includes(messageToSign.content.kind)) {
      this.messageToSign = messageToSign
      this.#accounts = accounts
      this.#accountStates = accountStates

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
    this.#accountStates = null
    this.#accounts = null
    this.signature = null
    this.signedMessage = null
    this.signingKeyAddr = null
    this.status = 'INITIAL'
    this.emitUpdate()
  }

  setSigningKeyAddr(signingKeyAddr: string) {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    this.signingKeyAddr = signingKeyAddr
    this.emitUpdate()
  }

  async sign() {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
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
      let sig

      if (this.messageToSign!.content.kind === 'message') {
        sig = await signer.signMessage(this.messageToSign!.content.message)
      }

      if (this.messageToSign!.content.kind === 'typedMessage') {
        const { domain, types, message } = this.messageToSign!.content
        // TODO: Figure out if the mismatch between the `TypedDataDomain` from
        // '@ethersproject/abstract-signer' and `TypedDataDomain` from 'ethers' is a problem
        sig = await signer.signTypedData(domain as TypedDataDomain, types, message)
      }

      const account = this.#accounts!.find((acc) => acc.addr === this.messageToSign?.accountAddr)
      const accountState = this.#accountStates![this.messageToSign!.accountAddr].polygon || {}

      if (!sig || !account) {
        this.emitError({
          level: 'major',
          message: 'Message signing failed. Please try again.',
          error: !account ? new Error('account is undefined') : new Error('signature is undefined')
        })
        return
      }

      if (!accountState.isEOA) {
        sig = `${mapSignatureV(sig as string)}00`

        if (!accountState.isDeployed) {
          sig = wrapSignature(sig, account.creation as AccountCreation)
        }
      }

      this.signedMessage = {
        id: this.messageToSign!.id,
        accountAddr: this.messageToSign!.accountAddr,
        signature: sig,
        content: this.messageToSign!.content
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

  #throwNotInitialized() {
    this.emitError({
      level: 'major',
      message:
        'Looks like there is an error while processing your sign message. Please retry, or contact support if issue persists.',
      error: new Error('signMessage: controller not initialized')
    })
  }
}
