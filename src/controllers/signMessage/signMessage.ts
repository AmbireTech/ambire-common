import { JsonRpcProvider } from 'ethers'

import { networks } from '../../consts/networks'
import { Account, AccountStates } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { messageHumanizer } from '../../libs/humanizer'
import { IrMessage } from '../../libs/humanizer/interfaces'
import { verifyMessage } from '../../libs/signMessage/signMessage'
import hexStringToUint8Array from '../../utils/hexStringToUint8Array'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'

export class SignMessageController extends EventEmitter {
  #keystore: KeystoreController

  #providers: { [key: string]: JsonRpcProvider }

  #storage: Storage

  #fetch: Function

  #accounts: Account[] | null = null

  // TODO: use it to determine whether the account is deployed and if not
  // apply EIP6492 but first the msg to sign should include the address of the account
  #accountStates: AccountStates | null = null

  isInitialized: boolean = false

  status: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  messageToSign: Message | null = null

  signingKeyAddr: Key['addr'] | null = null

  signingKeyType: Key['type'] | null = null

  humanReadable: IrMessage | null = null

  signedMessage: Message | null = null

  constructor(
    keystore: KeystoreController,
    providers: { [key: string]: JsonRpcProvider },
    storage: Storage,
    fetch: Function
  ) {
    super()

    this.#keystore = keystore
    this.#providers = providers
    this.#storage = storage
    this.#fetch = fetch
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

      // TODO: add knownAddresses
      messageHumanizer(
        messageToSign,
        [],
        this.#storage,
        this.#fetch,
        (humanizedMessage: IrMessage) => {
          this.humanReadable = humanizedMessage
          this.emitUpdate()
        },
        (err) => this.emitError(err)
      )

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
    this.signedMessage = null
    this.signingKeyAddr = null
    this.humanReadable = null
    this.status = 'INITIAL'
    this.emitUpdate()
  }

  setSigningKey(signingKeyAddr: Key['addr'], signingKeyType: Key['type']) {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    this.signingKeyAddr = signingKeyAddr
    this.signingKeyType = signingKeyType
    this.emitUpdate()
  }

  // TODO: missing type
  async sign(controller?: any) {
    if (!this.isInitialized || !this.messageToSign) {
      this.#throwNotInitialized()
      return
    }

    if (!this.signingKeyAddr || !this.signingKeyType) {
      return this.emitError({
        level: 'major',
        message: 'Please select a signing key and try again.',
        error: new Error('No request to sign.')
      })
    }

    this.status = 'LOADING'
    this.emitUpdate()

    try {
      const signer = await this.#keystore.getSigner(this.signingKeyAddr, this.signingKeyType)
      if (this.signingKeyType === 'ledger') {
        // TODO: missing type
        signer.init(controller)
      }

      let sig

      const account = this.#accounts!.find((acc) => acc.addr === this.messageToSign?.accountAddr)
      let network = networks.find((n: NetworkDescriptor) => n.id === 'ethereum')

      if (this.messageToSign.content.kind === 'message') {
        try {
          sig = await signer.signMessage(this.messageToSign!.content.message)
        } catch (error: any) {
          return this.emitError({
            level: 'major',
            message:
              error?.message ||
              'Something went wrong while signing the message. Please try again later or contact support if the problem persists.',
            error
          })
        }
      }

      if (this.messageToSign.content.kind === 'typedMessage') {
        const { domain } = this.messageToSign!.content
        sig = await signer.signTypedData(this.messageToSign!.content)
        const requestedNetwork = networks.find((n) => Number(n.chainId) === Number(domain?.chainId))
        if (requestedNetwork) {
          network = requestedNetwork
        }
      }

      if (!sig || !account) {
        throw !account ? new Error('account is undefined') : new Error('signature is undefined')
      }

      const personalMsgToValidate =
        typeof this.messageToSign.content.message === 'string'
          ? hexStringToUint8Array(this.messageToSign.content.message)
          : this.messageToSign.content.message

      const isValidSig = await verifyMessage({
        provider: this.#providers[network?.id || 'ethereum'],
        signer: this.signingKeyAddr,
        signature: sig,
        message: (this.messageToSign.content.kind === 'typedMessage'
          ? null
          : personalMsgToValidate) as any,
        typedData: (this.messageToSign.content.kind === 'typedMessage'
          ? {
              domain: this.messageToSign.content.domain,
              types: this.messageToSign.content.types as any,
              message: this.messageToSign.content.message
            }
          : null) as any
      })
      if (!isValidSig) {
        throw new Error('Invalid signature')
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
