import { toUtf8String } from 'ethers'

import { EIP712TypedData } from '@safe-global/types-kit'

import EmittableError from '../../classes/EmittableError'
import ExternalSignerError from '../../classes/ExternalSignerError'
import { Account, IAccountsController } from '../../interfaces/account'
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { Hex } from '../../interfaces/hex'
import { IInviteController } from '../../interfaces/invite'
import {
  ExternalSignerControllers,
  IKeystoreController,
  Key,
  KeystoreSignerInterface
} from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import {
  ISignMessageController,
  SignMessageStatus,
  SignMessageUpdateParams
} from '../../interfaces/signMessage'
import { AuthorizationUserRequest, Message } from '../../interfaces/userRequest'
import {
  addMessage,
  addMessageSignature,
  getDefaultOwners,
  getImportedSignersThatHaveNotSigned,
  sortSigs
} from '../../libs/safe/safe'
import {
  getAppFormatted,
  getEIP712Signature,
  getPlainTextSignature,
  getVerifyMessageSignature,
  verifyMessage
} from '../../libs/signMessage/signMessage'
import hexStringToUint8Array from '../../utils/hexStringToUint8Array'
import { SignedMessage } from '../activity/types'
import EventEmitter from '../eventEmitter/eventEmitter'

const STATUS_WRAPPED_METHODS = {
  sign: 'INITIAL'
} as const

export class SignMessageController extends EventEmitter implements ISignMessageController {
  #keystore: IKeystoreController

  #providers: IProvidersController

  #networks: INetworksController

  #externalSignerControllers: ExternalSignerControllers

  #accounts: IAccountsController

  #invite: IInviteController

  #signer: KeystoreSignerInterface | undefined

  isInitialized: boolean = false

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  dapp: {
    name: string
    icon: string
  } | null = null

  messageToSign: Message | null = null

  signedMessage: SignedMessage | null = null

  #account?: Account

  #network?: Network

  // who are the signers that already signed this message
  // applicable on Safe message
  signed: string[] = []

  signers?: { addr: Key['addr']; type: Key['type'] }[]

  /**
   * the signed hash
   */
  hash?: string

  existsInSafeGlobal: boolean = false

  status: SignMessageStatus

  constructor(
    keystore: IKeystoreController,
    providers: IProvidersController,
    networks: INetworksController,
    accounts: IAccountsController,
    externalSignerControllers: ExternalSignerControllers,
    invite: IInviteController,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)

    this.#keystore = keystore
    this.#providers = providers
    this.#networks = networks
    this.#externalSignerControllers = externalSignerControllers
    this.#accounts = accounts
    this.#invite = invite
    this.status = SignMessageStatus.Initial
  }

  async init({
    dapp,
    messageToSign,
    signed,
    hash
  }: {
    dapp?: { name: string; icon: string }
    messageToSign: Message
    // who are the signers that already signed this message
    // applicable on Safe message
    signed?: string[]
    hash?: Hex
  }) {
    // In the unlikely case that the signMessage controller was already
    // initialized, but not reset, force reset it to prevent misleadingly
    // displaying the prev sign message request.
    if (this.isInitialized) this.reset()

    await this.#accounts.initialLoadPromise

    if (
      ['message', 'typedMessage', 'authorization-7702', 'siwe'].includes(messageToSign.content.kind)
    ) {
      if (dapp) this.dapp = dapp
      this.messageToSign = messageToSign
      this.signed = signed || []
      this.isInitialized = true

      this.#account = this.#accounts.accounts.find(
        (acc) => acc.addr === this.messageToSign?.accountAddr
      )
      if (!this.#account) {
        throw new Error(
          'Account details needed for the signing mechanism are not found. Please try again, re-import your account or contact support if nothing else helps.'
        )
      }
      this.#network = this.#networks.networks.find(
        (n: Network) => n.chainId === this.messageToSign!.chainId
      )
      if (!this.#network) {
        throw new Error('Network not supported on Ambire. Please contract support.')
      }

      const accountState = await this.#accounts.getOrFetchAccountOnChainState(
        this.#account.addr,
        this.#network.chainId
      )
      if (!accountState) {
        if (this.#network.disabled) {
          throw new Error(
            `Please enable ${this.#network.name} from settings -> networks to sign messages on it`
          )
        }
        throw new Error(`Account details missing. Please try again`)
      }

      if (this.#account.safeCreation) {
        // safe account have their default signers set here
        // if they cannot be chosen, signers are undefined
        this.signers = getDefaultOwners(
          accountState.importedAccountKeys,
          accountState.threshold,
          this.signed
        ).map((k) => ({
          addr: k.addr,
          type: k.type
        }))

        const notSigned = getImportedSignersThatHaveNotSigned(
          this.signed,
          accountState.importedAccountKeys.map((k) => k.addr)
        )
        if (this.signed.length && notSigned.length === 0) this.status = SignMessageStatus.Partial
        this.hash = hash
        this.existsInSafeGlobal = !!hash
      } else {
        // if the account is not safe & view only, set a default signer
        // the default signer should be the internal key if any
        this.signers = accountState.importedAccountKeys
          ? [
              accountState.importedAccountKeys.find((k) => k.type === 'internal') ||
                accountState.importedAccountKeys[0]!
            ]
          : undefined
      }

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

    this.#onAbortOperation()
    this.isInitialized = false
    this.dapp = null
    this.messageToSign = null
    this.signedMessage = null
    this.#account = undefined
    this.#network = undefined
    this.signed = []
    this.signers = undefined
    this.status = SignMessageStatus.Initial
    this.emitUpdate()
  }

  update({ isAutoLoginEnabledByUser, autoLoginDuration }: SignMessageUpdateParams) {
    if (!this.isInitialized) {
      this.emitError({
        level: 'major',
        message: 'There was an error while updating the sign message request. Please try again.',
        error: new Error('signMessage: controller not initialized')
      })
      return
    }

    if (this.messageToSign && this.messageToSign.content.kind === 'siwe') {
      if (typeof isAutoLoginEnabledByUser === 'boolean') {
        this.messageToSign.content.isAutoLoginEnabledByUser = !!isAutoLoginEnabledByUser
      }
      if (typeof autoLoginDuration === 'number') {
        this.messageToSign.content.autoLoginDuration = autoLoginDuration
      }
    }
    this.emitUpdate()
  }

  setSigners(signers: { addr: Key['addr']; type: Key['type'] }[]) {
    this.signers = signers
    this.emitUpdate()
  }

  /**
   * Checks if the signing operation is still valid after each async step, to guard
   * against a race condition where the operation is reset before the async operation is completed.
   */
  #isSigningOperationValidAfterAsyncOperation() {
    return this.isInitialized && !!this.messageToSign
  }

  /*
   * ⚠️ IMPORTANT: If you make changes here and they involve async operations,
   * make sure to check `isSigningOperationValidAfterAsyncOperation` afterwards
   * to ensure you’re not acting on obsolete data.
   */
  async #sign() {
    if (!this.isInitialized) {
      return SignMessageController.#throwNotInitialized()
    }

    if (!this.messageToSign) {
      return SignMessageController.#throwMissingMessage()
    }

    if (!this.signers?.length) {
      return SignMessageController.#throwMissingSigningKey()
    }

    try {
      if (!this.#isSigningOperationValidAfterAsyncOperation()) return
      if (!this.#account) {
        throw new Error(
          'Account details needed for the signing mechanism are not found. Please try again, re-import your account or contact support if nothing else helps.'
        )
      }
      if (!this.#network) {
        throw new Error('Network not supported on Ambire. Please contract support.')
      }

      const accountState = await this.#accounts.getOrFetchAccountOnChainState(
        this.#account.addr,
        this.#network.chainId
      )
      if (!accountState) {
        throw new Error(`Account details missing. Please try again`)
      }

      const provider = this.#providers.providers[this.#network.chainId.toString()]
      if (!provider) throw new Error(`Network details missing. Please try again`)

      let signature

      try {
        if (
          this.messageToSign.content.kind === 'message' ||
          this.messageToSign.content.kind === 'siwe'
        ) {
          const signatures: Hex[] = []

          for (let i = 0; i < this.signers.length; i++) {
            const signerKey = this.signers[i]!
            this.#signer = await this.#keystore.getSigner(signerKey.addr, signerKey.type)
            if (this.#signer.init) {
              this.#signer.init(this.#externalSignerControllers[signerKey.type])
            }
            // announce the next signer as the first has already been
            if (i !== 0) this.emitUpdate()

            const signed = await getPlainTextSignature(
              this.messageToSign.content.message,
              this.#network,
              this.#account,
              accountState,
              this.#signer,
              this.#invite.isOG
            )
            signatures.push(signed.signature)
            this.signed.push(signerKey.addr)
            if (signed.hash) this.hash = signed.hash
            if (this.existsInSafeGlobal && this.hash) {
              await addMessageSignature(this.#network.chainId, this.hash, signed.signature)
            }
          }

          if (!this.#isSigningOperationValidAfterAsyncOperation()) return

          // get the final signature
          signature =
            signatures.length === 1 || !this.hash ? signatures[0]! : sortSigs(signatures, this.hash)

          // send only to safe global if it doesn't already exists and if the threshold is not met
          if (!this.existsInSafeGlobal && signatures.length < accountState.threshold) {
            await addMessage(
              this.#network.chainId,
              this.#account.addr as Hex,
              toUtf8String(this.messageToSign.content.message),
              signature
            )
          }
        }

        if (this.messageToSign.content.kind === 'typedMessage') {
          if (this.#account.creation && this.messageToSign.content.primaryType === 'Permit') {
            throw new Error(
              'It looks like that this app doesn\'t detect Smart Account wallets, and requested incompatible approval type. Please, go back to the app and change the approval type to "Transaction", which is supported by Smart Account wallets.'
            )
          }

          const signatures: Hex[] = []
          for (let i = 0; i < this.signers.length; i++) {
            const signerKey = this.signers[i]!
            this.#signer = await this.#keystore.getSigner(signerKey.addr, signerKey.type)
            if (this.#signer.init) {
              this.#signer.init(this.#externalSignerControllers[signerKey.type])
            }
            // announce the next signer as the first has already been
            if (i !== 0) this.emitUpdate()

            const signed = await getEIP712Signature(
              this.messageToSign.content,
              this.#account,
              accountState,
              this.#signer,
              this.#network,
              this.#invite.isOG
            )

            signatures.push(signed.signature)
            this.signed.push(signerKey.addr)
            if (signed.hash) this.hash = signed.hash
            if (this.existsInSafeGlobal && this.hash) {
              await addMessageSignature(this.#network.chainId, this.hash, signed.signature)
            }
          }
          if (!this.#isSigningOperationValidAfterAsyncOperation()) return

          signature =
            signatures.length === 1 || !this.hash ? signatures[0]! : sortSigs(signatures, this.hash)

          // send only to safe global if it doesn't already exists and if the threshold is not met
          if (!this.existsInSafeGlobal && signatures.length < accountState.threshold) {
            console.log('is this the typed data?', this.messageToSign.content.message)
            await addMessage(
              this.#network.chainId,
              this.#account.addr as Hex,
              this.messageToSign.content.message as EIP712TypedData,
              signature
            )
          }
        }

        if (this.messageToSign.content.kind === 'authorization-7702') {
          // TODO: Deprecated. Sync with the latest sign7702 method changes if used
          // signature = this.#signer.sign7702(this.messageToSign.content.message)
          throw new ExternalSignerError(
            'Signing EIP-7702 authorization via this flow is not implemented',
            { sendCrashReport: true }
          )
        }
      } catch (error: any) {
        throw new ExternalSignerError(
          error?.message ||
            'Something went wrong while signing the message. Please try again later or contact support if the problem persists.',
          {
            sendCrashReport: error?.sendCrashReport
          }
        )
      }

      if (!signature) {
        throw new Error(
          'Ambire was not able to retrieve the signature. Please try again or contact support if the problem persists.'
        )
      }

      if (!this.#account.safeCreation) {
        // todo: configure this to work with Safes
        const verifyMessageParams = {
          provider,
          // the signer is always the account even if the actual
          // signature is from a key that has privs to the account
          signer: this.messageToSign.accountAddr,
          signature: getVerifyMessageSignature(signature, this.#account, accountState),
          // eslint-disable-next-line no-nested-ternary
          ...(this.messageToSign.content.kind === 'message' ||
          this.messageToSign.content.kind === 'siwe'
            ? { message: hexStringToUint8Array(this.messageToSign.content.message) }
            : this.messageToSign.content.kind === 'typedMessage'
              ? {
                  typedData: {
                    domain: this.messageToSign.content.domain,
                    types: this.messageToSign.content.types,
                    message: this.messageToSign.content.message,
                    primaryType: this.messageToSign.content.primaryType
                  }
                }
              : {
                  authorization: (
                    this.messageToSign.content as AuthorizationUserRequest['meta']['params'] & {
                      kind: AuthorizationUserRequest['kind']
                    }
                  ).message
                })
        }
        const isValidSignature = await verifyMessage(verifyMessageParams)
        if (!this.#isSigningOperationValidAfterAsyncOperation()) return

        if (!isValidSignature) {
          throw new Error(
            'Ambire failed to validate the signature. Please make sure you are signing with the correct key or device. If the problem persists, please contact Ambire support.'
          )
        }
      }

      this.signedMessage = {
        ...this.messageToSign,
        timestamp: new Date().getTime(),
        // todo: configure
        signature: getAppFormatted(signature, this.#account, accountState),
        dapp: this.dapp
      }

      // update the status to Partial if signing has not concluded
      this.status =
        this.signed.length >= accountState.threshold
          ? SignMessageStatus.Done
          : SignMessageStatus.Partial

      return this.signedMessage
    } catch (e: any) {
      const error = e instanceof Error ? e : new Error(`Signing failed. Error details: ${e}`)
      const message =
        e?.message || 'Something went wrong while signing the message. Please try again.'

      return Promise.reject(
        new EmittableError({
          level: 'major',
          message,
          error,
          sendCrashReport: e?.sendCrashReport
        })
      )
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

  #onAbortOperation() {
    if (this.#signer?.signingCleanup) {
      this.#signer.signingCleanup()
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
    const message = 'Please select a signer.'
    const error = new Error('signMessage: missing selected signer')

    return Promise.reject(new EmittableError({ level: 'major', message, error }))
  }
}
