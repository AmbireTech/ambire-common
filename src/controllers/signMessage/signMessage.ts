import { hexlify, isHexString, toUtf8Bytes } from 'ethers'

import EmittableError from '../../classes/EmittableError'
import { Account } from '../../interfaces/account'
import { ExternalSignerControllers, Key } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { Message } from '../../interfaces/userRequest'
import {
  getEIP712Signature,
  getPlainTextSignature,
  verifyMessage,
  wrapCounterfactualSign
} from '../../libs/signMessage/signMessage'
import hexStringToUint8Array from '../../utils/hexStringToUint8Array'
import { AccountsController } from '../accounts/accounts'
import { SignedMessage } from '../activity/activity'
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'

const STATUS_WRAPPED_METHODS = {
  sign: 'INITIAL'
} as const

export class SignMessageController extends EventEmitter {
  #keystore: KeystoreController

  #providers: ProvidersController

  #networks: NetworksController

  #externalSignerControllers: ExternalSignerControllers

  #accounts: AccountsController

  // this is the signer from keystore.ts
  // we don't have a correct return type at getSigner so
  // I'm leaving it as any
  #signer: any

  isInitialized: boolean = false

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  dapp: {
    name: string
    icon: string
  } | null = null

  messageToSign: Message | null = null

  signingKeyAddr: Key['addr'] | null = null

  signingKeyType: Key['type'] | null = null

  signedMessage: SignedMessage | null = null

  constructor(
    keystore: KeystoreController,
    providers: ProvidersController,
    networks: NetworksController,
    accounts: AccountsController,
    externalSignerControllers: ExternalSignerControllers
  ) {
    super()

    this.#keystore = keystore
    this.#providers = providers
    this.#networks = networks
    this.#externalSignerControllers = externalSignerControllers
    this.#accounts = accounts
  }

  async init({
    dapp,
    messageToSign
  }: {
    dapp?: { name: string; icon: string }
    messageToSign: Message
  }) {
    // In the unlikely case that the signMessage controller was already
    // initialized, but not reset, force reset it to prevent misleadingly
    // displaying the prev sign message request.
    if (this.isInitialized) this.reset()

    await this.#accounts.initialLoadPromise

    if (['message', 'typedMessage'].includes(messageToSign.content.kind)) {
      if (dapp) {
        this.dapp = dapp
      }
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
    if (!this.isInitialized) return

    this.isInitialized = false
    this.dapp = null
    this.messageToSign = null
    this.signedMessage = null
    this.signingKeyAddr = null
    this.signingKeyType = null
    this.emitUpdate()
  }

  setSigningKey(signingKeyAddr: Key['addr'], signingKeyType: Key['type']) {
    this.signingKeyAddr = signingKeyAddr
    this.signingKeyType = signingKeyType
    this.emitUpdate()
  }

  async #sign() {
    if (!this.isInitialized) {
      return SignMessageController.#throwNotInitialized()
    }

    if (!this.messageToSign) {
      return SignMessageController.#throwMissingMessage()
    }

    if (!this.signingKeyAddr || !this.signingKeyType) {
      return SignMessageController.#throwMissingSigningKey()
    }

    try {
      this.#signer = await this.#keystore.getSigner(this.signingKeyAddr, this.signingKeyType)
      if (this.#signer.init) this.#signer.init(this.#externalSignerControllers[this.signingKeyType])

      const account = this.#accounts.accounts.find(
        (acc) => acc.addr === this.messageToSign?.accountAddr
      )
      if (!account) {
        throw new Error(
          'Account details needed for the signing mechanism are not found. Please try again, re-import your account or contact support if nothing else helps.'
        )
      }
      const network = this.#networks.networks.find(
        // @ts-ignore this.messageToSign is not null and it has a check
        // but typescript malfunctions here
        (n: Network) => n.id === this.messageToSign.networkId
      )
      if (!network) {
        throw new Error('Network not supported on Ambire. Please contract support.')
      }

      const accountState = this.#accounts.accountStates[account.addr][network.id]
      let signature
      try {
        if (this.messageToSign.content.kind === 'message') {
          const message = this.messageToSign.content.message
          this.messageToSign.content.message = isHexString(message)
            ? message
            : hexlify(toUtf8Bytes(message.toString()))

          signature = await getPlainTextSignature(
            this.messageToSign.content.message,
            network,
            account,
            accountState,
            this.#signer
          )
        }

        if (this.messageToSign.content.kind === 'typedMessage') {
          if (account.creation && this.messageToSign.content.primaryType === 'Permit') {
            throw new Error(
              'It looks like that this dApp doesn\'t detect Smart Account wallets, and requested incompatible approval type. Please, go back to the dApp and change the approval type to "Transaction", which is supported by Smart Account wallets.'
            )
          }

          signature = await getEIP712Signature(
            this.messageToSign.content,
            account,
            accountState,
            this.#signer,
            network
          )
        }
      } catch (error: any) {
        throw new Error(
          error?.message ||
            'Something went wrong while signing the message. Please try again later or contact support if the problem persists.'
        )
      }

      if (!signature) {
        throw new Error(
          'Ambire was not able to retrieve the signature. Please try again or contact support if the problem persists.'
        )
      }

      // if the account is not deployed, it should be wrapped with EIP-6492
      // magic bytes. The only exception is when we're asking the user to
      // sign an AmbireOperation (entry point deploy)
      signature =
        account.creation &&
        !accountState.isDeployed &&
        (this.messageToSign.content.kind !== 'typedMessage' ||
          this.messageToSign.content.primaryType !== 'AmbireOperation')
          ? // https://eips.ethereum.org/EIPS/eip-6492
            wrapCounterfactualSign(signature, account.creation!)
          : signature

      const personalMsgToValidate =
        typeof this.messageToSign.content.message === 'string'
          ? hexStringToUint8Array(this.messageToSign.content.message)
          : this.messageToSign.content.message

      const isValidSignature = await verifyMessage({
        network,
        provider: this.#providers.providers[network?.id || 'ethereum'],
        // the signer is always the account even if the actual
        // signature is from a key that has privs to the account
        signer: this.messageToSign?.accountAddr,
        // for verification, if the signature is an AmbireOperation,
        // wrap in with the magic bytes
        signature:
          this.messageToSign.content.kind === 'typedMessage' &&
          this.messageToSign.content.primaryType === 'AmbireOperation'
            ? // https://eips.ethereum.org/EIPS/eip-6492
              wrapCounterfactualSign(signature, account.creation!)
            : signature,
        // @ts-ignore TODO: Be aware of the type mismatch, could cause troubles
        message: this.messageToSign.content.kind === 'message' ? personalMsgToValidate : undefined,
        typedData:
          this.messageToSign.content.kind === 'typedMessage'
            ? {
                domain: this.messageToSign.content.domain,
                types: this.messageToSign.content.types,
                message: this.messageToSign.content.message
              }
            : undefined
      })

      if (!isValidSignature) {
        throw new Error(
          'Ambire failed to validate the signature. Please make sure you are signing with the correct key or device. If the problem persists, please contact Ambire support.'
        )
      }

      this.signedMessage = {
        fromActionId: this.messageToSign.fromActionId,
        accountAddr: this.messageToSign.accountAddr,
        networkId: this.messageToSign.networkId,
        content: this.messageToSign.content,
        timestamp: new Date().getTime(),
        signature,
        dapp: this.dapp
      }

      return this.signedMessage
    } catch (e: any) {
      const error = e instanceof Error ? e : new Error(`Signing failed. Error details: ${e}`)
      const message =
        e?.message || 'Something went wrong while signing the message. Please try again.'

      return Promise.reject(new EmittableError({ level: 'major', message, error }))
    }
  }

  async sign() {
    await this.withStatus('sign', async () => this.#sign())
  }

  removeAccountData(address: Account['addr']) {
    if (this.messageToSign?.accountAddr.toLowerCase() === address.toLowerCase()) {
      this.reset()
    }
  }

  static #throwNotInitialized() {
    const message =
      'Looks like there is an error while processing your sign message. Please retry, or contact support if issue persists.'
    const error = new Error('signMessage: controller not initialized')

    return Promise.reject(new EmittableError({ level: 'major', message, error }))
  }

  static #throwMissingMessage() {
    const message =
      'Looks like there is an error while processing your sign message. Please retry, or contact support if issue persists.'
    const error = new Error('signMessage: missing message to sign')

    return Promise.reject(new EmittableError({ level: 'major', message, error }))
  }

  static #throwMissingSigningKey() {
    const message = 'Please select a signing key and try again.'
    const error = new Error('signMessage: missing selected signing key')

    return Promise.reject(new EmittableError({ level: 'major', message, error }))
  }
}
