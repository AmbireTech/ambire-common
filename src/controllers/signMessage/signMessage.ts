import { ethers } from 'ethers'

import { networks } from '../../consts/networks'
import { Account, AccountStates } from '../../interfaces/account'
import { ExternalSignerControllers, Key } from '../../interfaces/keystore'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { getKnownAddressLabels } from '../../libs/account/account'
import { messageHumanizer } from '../../libs/humanizer'
import { IrMessage } from '../../libs/humanizer/interfaces'
import {
  verifyMessage,
  wrapCounterfactualSign,
  wrapEIP712,
  wrapEthSign
} from '../../libs/signMessage/signMessage'
import hexStringToUint8Array from '../../utils/hexStringToUint8Array'
import { SignedMessage } from '../activity/activity'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { SettingsController } from '../settings/settings'

export class SignMessageController extends EventEmitter {
  #keystore: KeystoreController

  #settings: SettingsController

  #externalSignerControllers: ExternalSignerControllers

  #storage: Storage

  #fetch: Function

  #accounts: Account[] | null = null

  // TODO: use it to determine whether the account is deployed and if not
  // apply EIP6492 but first the msg to sign should include the address of the account
  #accountStates: AccountStates | null = null

  isInitialized: boolean = false

  status: 'INITIAL' | 'LOADING' | 'DONE' = 'INITIAL'

  dapp: {
    name: string
    icon: string
  } | null = null

  messageToSign: Message | null = null

  signingKeyAddr: Key['addr'] | null = null

  signingKeyType: Key['type'] | null = null

  humanReadable: IrMessage | null = null

  signedMessage: SignedMessage | null = null

  constructor(
    keystore: KeystoreController,
    settings: SettingsController,
    externalSignerControllers: ExternalSignerControllers,
    storage: Storage,
    fetch: Function
  ) {
    super()

    this.#keystore = keystore
    this.#settings = settings
    this.#externalSignerControllers = externalSignerControllers
    this.#storage = storage
    this.#fetch = fetch
  }

  init({
    dapp,
    messageToSign,
    accounts,
    accountStates
  }: {
    dapp?: {
      name: string
      icon: string
    }
    messageToSign: Message
    accounts: Account[]
    accountStates: AccountStates
  }) {
    if (['message', 'typedMessage'].includes(messageToSign.content.kind)) {
      if (dapp) {
        this.dapp = dapp
      }
      this.messageToSign = messageToSign
      this.#accounts = accounts
      this.#accountStates = accountStates
      const knownAddressLabels = getKnownAddressLabels(
        this.#accounts,
        this.#settings.accountPreferences,
        this.#keystore.keys,
        this.#settings.keyPreferences
      )

      messageHumanizer(
        messageToSign,
        knownAddressLabels,
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
    this.dapp = null
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

  async sign() {
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
      if (signer.init) signer.init(this.#externalSignerControllers[this.signingKeyType])

      const account = this.#accounts!.find((acc) => acc.addr === this.messageToSign?.accountAddr)
      if (!account) {
        throw new Error(
          'Account details needed for the signing mechanism are not found. Please try again, re-import your account or contact support if nothing else helps.'
        )
      }

      let network = networks.find((n: NetworkDescriptor) => n.id === 'ethereum')
      let signature

      if (this.messageToSign.content.kind === 'message') {
        try {
          const { message } = this.messageToSign.content
          const messageHex = message instanceof Uint8Array ? ethers.hexlify(message) : message

          signature = await signer.signMessage(messageHex)
          if (signature && account.creation) signature = wrapEthSign(signature)
        } catch (error: any) {
          throw new Error(
            error?.message ||
              'Something went wrong while signing the message. Please try again later or contact support if the problem persists.'
          )
        }
      }

      if (this.messageToSign.content.kind === 'typedMessage') {
        try {
          if (!this.messageToSign.content.types.EIP712Domain) {
            throw new Error(
              'Ambire only supports signing EIP712 typed data messages. Please try again with a valid EIP712 message.'
            )
          }

          if (!this.messageToSign.content.primaryType) {
            throw new Error(
              'The primaryType is missing in the typed data message incoming. Please try again with a valid EIP712 message.'
            )
          }

          const { domain } = this.messageToSign.content
          signature = await signer.signTypedData(this.messageToSign.content)
          if (signature && account.creation) signature = wrapEIP712(signature)
          const requestedNetwork = networks.find(
            (n) => Number(n.chainId) === Number(domain.chainId)
          )
          if (requestedNetwork) {
            network = requestedNetwork
          }
        } catch (error: any) {
          throw new Error(
            error?.message ||
              'Something went wrong while signing the typed data message. Please try again later or contact support if the problem persists.'
          )
        }
      }

      if (!signature) {
        throw new Error(
          'Ambire was not able to retrieve the signature. Please try again or contact support if the problem persists.'
        )
      }

      // https://eips.ethereum.org/EIPS/eip-6492
      const accountState = this.#accountStates![account.addr][network!.id]
      if (account.creation && !accountState.isDeployed) {
        signature = wrapCounterfactualSign(signature, account.creation!)
      }

      const personalMsgToValidate =
        typeof this.messageToSign.content.message === 'string'
          ? hexStringToUint8Array(this.messageToSign.content.message)
          : this.messageToSign.content.message

      const isValidSignature = await verifyMessage({
        provider: this.#settings.providers[network?.id || 'ethereum'],
        // the signer is always the account even if the actual
        // signature is from a key that has privs to the account
        signer: this.messageToSign?.accountAddr,
        signature,
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
        id: this.messageToSign.id,
        dapp: this.dapp,
        accountAddr: this.messageToSign.accountAddr,
        networkId: this.messageToSign.networkId,
        signature,
        timestamp: new Date().getTime(),
        content: this.messageToSign.content
      }
    } catch (e: any) {
      const error = e instanceof Error ? e : new Error(`Signing failed. Error details: ${e}`)

      this.emitError({
        level: 'major',
        message: e?.message || 'Something went wrong while signing the message. Please try again.',
        error
      })
    } finally {
      this.status = 'DONE'
      this.emitUpdate()
    }
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
