import { toUtf8String } from 'ethers'

import { BindedRelayerCall } from '@/libs/relayerCall/relayerCall'
import { EIP712TypedData } from '@safe-global/types-kit'

import EmittableError from '../../classes/EmittableError'
import ExternalSignerError from '../../classes/ExternalSignerError'
import { SAFE_API_TIMEOUT_MS } from '../../consts/safe'
import { Account, IAccountsController } from '../../interfaces/account'
import {
  DAPP_VERIFICATION_BANNER_IDS,
  DappVerificationBanner,
  IDappsController
} from '../../interfaces/dapp'
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
import { fetchErc7730DescriptorForMessage, humanizeMessage } from '../../libs/humanizer'
import {
  addMessage,
  addMessageSignature,
  getImportedSignersThatHaveNotSigned,
  sortSigs
} from '../../libs/safe/safe'
import {
  getEIP712SigningRequest,
  getSigningRequestDisplayData
} from '../../libs/signingRequest/signingRequest'
import {
  AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE,
  getAppFormatted,
  getEIP712Hash,
  getEIP712Signature,
  getPlainTextSignature,
  getSafeMessageTypedData,
  getVerifyMessageSignature,
  verifyMessage,
  isAmbireOperationTypedData
} from '../../libs/signMessage/signMessage'
import hexStringToUint8Array from '../../utils/hexStringToUint8Array'
import { withTimeout } from '../../utils/with-timeout'
import { SignedMessage } from '../activity/types'
import HumanizationController from '../humanization/humanization'

import type { HardwareWalletSigningRequest } from '../../interfaces/signAccountOp'
import type { IrMessage } from '../../libs/humanizer/interfaces'
const STATUS_WRAPPED_METHODS = {
  sign: 'INITIAL'
} as const

export class SignMessageController
  extends HumanizationController
  implements ISignMessageController
{
  #keystore: IKeystoreController

  #providers: IProvidersController

  networks: INetworksController

  #externalSignerControllers: ExternalSignerControllers

  #accounts: IAccountsController

  #invite: IInviteController

  #dapps?: IDappsController

  #callRelayer?: BindedRelayerCall

  // Bumped on every init()/reset(); a signing op captures it before its first
  // await and re-checks after each, so a request replacing the message mid-sign
  // can't be signed under the previous approval.
  #signingGeneration = 0

  signer?: KeystoreSignerInterface

  isInitialized: boolean = false

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  dapp: {
    name: string
    icon: string
    url?: string
    sessionId?: string
  } | null = null

  messageToSign: Message | null = null

  humanizedMessage?: IrMessage

  isHumanizing = false

  safeEip712Data: unknown | null = null

  hardwareWalletSigningRequest: HardwareWalletSigningRequest | null = null

  signedMessage: SignedMessage | null = null

  #account?: Account

  network?: Network

  // who are the signers that already signed this message
  // applicable on Safe message
  signed: string[] = []

  // the already signed signatures
  // applicable on Safe message
  signatures: Hex[] = []

  signers?: { addr: Key['addr']; type: Key['type'] }[]

  /**
   * the signed hash
   */
  hash?: Hex

  status: SignMessageStatus

  constructor(
    keystore: IKeystoreController,
    providers: IProvidersController,
    networks: INetworksController,
    accounts: IAccountsController,
    externalSignerControllers: ExternalSignerControllers,
    invite: IInviteController,
    eventEmitterRegistry?: IEventEmitterRegistryController,
    dapps?: IDappsController,
    callRelayer?: BindedRelayerCall
  ) {
    super(eventEmitterRegistry)

    this.#keystore = keystore
    this.#providers = providers
    this.networks = networks
    this.#externalSignerControllers = externalSignerControllers
    this.#accounts = accounts
    this.#invite = invite
    this.#dapps = dapps
    this.#callRelayer = callRelayer
    this.status = SignMessageStatus.Initial

    // `banners` is derived from DappsController state (the dapp verification status), so its
    // updates must be propagated - otherwise a banner computed before the status resolves
    // (e.g. right after a service worker restart) would stay stale in the UI until this
    // controller happens to emit for another reason.
    // NOTE: No unsubscribe needed - both controllers are singletons living for the app lifetime.
    this.#dapps?.onUpdate((forceEmit) => {
      if (this.dapp?.url) this.propagateUpdate(forceEmit)
    }, 'sign-message-dapps-verification')
  }

  async init({
    dapp,
    messageToSign,
    signed,
    hash,
    signatures
  }: {
    dapp?: { name: string; icon: string; url?: string; sessionId?: string }
    messageToSign: Message
    // who are the signers that already signed this message
    // applicable on Safe message
    signed?: string[]
    hash?: Hex
    signatures?: Hex[]
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
      this.#signingGeneration += 1
      this.signed = signed || []
      this.signatures = signatures || []
      this.isInitialized = true

      this.#account = this.#accounts.accounts.find(
        (acc) => acc.addr === this.messageToSign?.accountAddr
      )
      if (!this.#account) {
        throw new Error(
          'Account details needed for the signing mechanism are not found. Please try again, re-import your account or contact support if nothing else helps.'
        )
      }
      this.network = this.networks.networks.find(
        (n: Network) => n.chainId === this.messageToSign!.chainId
      )
      if (!this.network) {
        throw new Error('Network not supported on Ambire. Please contract support.')
      }

      const accountState = await this.#accounts.getOrFetchAccountOnChainState(
        this.#account.addr,
        this.network.chainId
      )
      if (!accountState) {
        if (this.network.disabled) {
          throw new Error(
            `Please enable ${this.network.name} from settings -> networks to sign messages on it`
          )
        }
        throw new Error(`Account details missing. Please try again`)
      }

      if (this.#account.safeCreation) {
        this.#updateSafeEip712Data()
        const notSigned = getImportedSignersThatHaveNotSigned(
          this.signed,
          accountState.importedAccountKeys.map((k) => k.addr)
        )
        if (this.signed.length && notSigned.length === 0) this.status = SignMessageStatus.Partial
        this.hash = hash
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
      this.humanize()
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
    this.#signingGeneration += 1
    this.isInitialized = false
    this.dapp = null
    this.messageToSign = null
    this.humanizedMessage = undefined
    this.isHumanizing = false
    this.safeEip712Data = null
    this.hardwareWalletSigningRequest = null
    this.signedMessage = null
    this.#account = undefined
    this.network = undefined
    this.signed = []
    this.signers = undefined
    this.signer = undefined
    this.status = SignMessageStatus.Initial
    this.emitUpdate()
  }

  #updateSafeEip712Data() {
    if (!this.#account?.safeCreation || !this.messageToSign || !this.network) {
      this.safeEip712Data = null
      return
    }

    const { content } = this.messageToSign

    try {
      const message = content.kind === 'typedMessage' ? content : content.message
      const typedData = getSafeMessageTypedData(
        message,
        this.network.chainId,
        this.#account.addr as Hex
      )
      const safeMessageHash = getEIP712Hash(typedData)

      this.safeEip712Data = getSigningRequestDisplayData(
        getEIP712SigningRequest({ ...typedData, safeMessageHash })
      )
    } catch (error) {
      this.safeEip712Data = null
      this.emitError({
        message: 'Error calculating Safe EIP-712 data',
        error: error instanceof Error ? error : new Error(String(error)),
        level: 'silent'
      })
    }
  }

  #setHardwareWalletSigningRequest(request: HardwareWalletSigningRequest | null) {
    let serializedRequestData: unknown = null

    try {
      if (request) serializedRequestData = getSigningRequestDisplayData(request)
    } catch {
      serializedRequestData = null
    }

    this.hardwareWalletSigningRequest =
      request && serializedRequestData !== null
        ? {
            ...request,
            data: serializedRequestData
          }
        : null
    this.emitUpdate()
  }

  async #withHardwareWalletSigningRequest<T>(
    request: HardwareWalletSigningRequest,
    sign: () => Promise<T>
  ) {
    this.#setHardwareWalletSigningRequest(request)

    try {
      return await sign()
    } finally {
      this.#setHardwareWalletSigningRequest(null)
    }
  }

  #startHumanization() {
    return this.startHumanization(() => {
      this.isHumanizing = true
      this.humanizedMessage = undefined
    })
  }

  #setHumanizedMessage(humanizedMessage: IrMessage, humanizationId: number) {
    if (!this.isCurrentHumanization(humanizationId)) return false

    this.humanizedMessage = humanizedMessage
    this.isHumanizing = false
    this.emitUpdate()

    return true
  }

  #setFallbackHumanization(humanizationId: number) {
    if (!this.messageToSign) return false

    return this.#setHumanizedMessage(humanizeMessage(this.messageToSign), humanizationId)
  }

  async #applyDescriptorFirstHumanization(humanizationId: number) {
    const messageToSign = this.messageToSign
    const callRelayer = this.#callRelayer

    if (!messageToSign) return
    if (messageToSign.content.kind !== 'typedMessage' || !callRelayer) {
      this.#setFallbackHumanization(humanizationId)
      return
    }

    await this.applyDescriptorFirstHumanization({
      humanizationId,
      fetchDescriptor: async () => {
        const provider = this.network
          ? this.#providers.providers[this.network.chainId.toString()]
          : undefined

        return fetchErc7730DescriptorForMessage(messageToSign, callRelayer, provider)
      },
      applyDescriptorHumanization: (erc7730Descriptor, currentHumanizationId) => {
        if (!erc7730Descriptor) return false

        const erc7730Humanization = humanizeMessage(messageToSign, { erc7730Descriptor })

        return this.#setHumanizedMessage(erc7730Humanization, currentHumanizationId)
      },
      applyFallbackHumanization: (currentHumanizationId) =>
        this.#setFallbackHumanization(currentHumanizationId)
    })
  }

  humanize() {
    if (!this.messageToSign) return

    if (this.messageToSign.content.kind !== 'typedMessage' || !this.#callRelayer) {
      const currentHumanizationId = this.#startHumanization()
      this.#setFallbackHumanization(currentHumanizationId)
      return
    }

    const currentHumanizationId = this.#startHumanization()
    void this.#applyDescriptorFirstHumanization(currentHumanizationId)
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
   * against a race condition where the operation is reset or the installed message is
   * replaced before the async operation is completed. The `signingGeneration` captured
   * at the start of the operation must still match, otherwise a same-kind request that
   * called init() mid-signing would get its payload signed under the previous approval.
   */
  #isSigningOperationValidAfterAsyncOperation(signingGeneration: number) {
    return (
      this.isInitialized && !!this.messageToSign && this.#signingGeneration === signingGeneration
    )
  }

  async addMsgToSafeGlobal(sig: string, message: string | EIP712TypedData) {
    const network = this.network
    const account = this.#account
    if (!network || !account) return

    // send only to Safe Global if it doesn't already exists and if the threshold is not met
    await withTimeout(() => addMessage(network.chainId, account.addr as Hex, message, sig), {
      timeoutMs: SAFE_API_TIMEOUT_MS,
      message: `Safe API: add message timed out after ${SAFE_API_TIMEOUT_MS}ms`
    }).catch((e) => {
      console.log('failed to send message to Safe Global: ', e)
    })
  }

  async addSigToSafeGlobal(sig: string, hash: string) {
    const network = this.network
    if (!network) return

    await withTimeout(() => addMessageSignature(network.chainId, hash, sig), {
      timeoutMs: SAFE_API_TIMEOUT_MS,
      message: `Safe API: add message signature timed out after ${SAFE_API_TIMEOUT_MS}ms`
    }).catch((e) => {
      console.log('failed to send message to Safe Global: ', e)
    })
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

    // Bind this op to the current message; if init() replaces it during any
    // await below, the generation changes and the op aborts.
    const signingGeneration = this.#signingGeneration

    // we're always signing with the first signer
    // the goal was to have an array of signers that sign simultaneously
    // but it was too confusing, so we threw it away
    // the array of signers should be changed back to a single signer
    const signerKey = this.signers[0]!
    this.signer = await this.#keystore.getSigner(signerKey.addr, signerKey.type)
    if (this.signer.init) {
      this.signer.init(this.#externalSignerControllers[signerKey.type])
    }
    this.emitUpdate() // pass the signer to the UI

    try {
      if (!this.#isSigningOperationValidAfterAsyncOperation(signingGeneration)) return
      if (!this.#account) {
        throw new Error(
          'Account details needed for the signing mechanism are not found. Please try again, re-import your account or contact support if nothing else helps.'
        )
      }
      if (!this.network) {
        throw new Error('Network not supported on Ambire. Please contract support.')
      }

      const accountState = await this.#accounts.getOrFetchAccountOnChainState(
        this.#account.addr,
        this.network.chainId
      )
      if (!accountState) {
        throw new Error(`Account details missing. Please try again`)
      }

      const provider = this.#providers.providers[this.network.chainId.toString()]
      if (!provider) throw new Error(`Network details missing. Please try again`)

      let signature

      try {
        if (
          this.messageToSign.content.kind === 'message' ||
          this.messageToSign.content.kind === 'siwe'
        ) {
          const signed = await getPlainTextSignature(
            this.messageToSign.content.message,
            this.network,
            this.#account,
            accountState,
            this.signer,
            this.#invite.isOG,
            (request, sign) => this.#withHardwareWalletSigningRequest(request, sign)
          )
          this.signatures.push(signed.signature)
          this.signed.push(signerKey.addr)

          if (accountState.threshold > 1) {
            if (!!this.#account.safeCreation && signed.hash) {
              this.hash = signed.hash
              if (this.signed.length === 1) {
                await this.addMsgToSafeGlobal(
                  signed.signature,
                  toUtf8String(this.messageToSign.content.message)
                )
              } else {
                await this.addSigToSafeGlobal(signed.signature, signed.hash)
              }
            }
          }

          if (!this.#isSigningOperationValidAfterAsyncOperation(signingGeneration)) return

          // get the final signature
          signature =
            this.signatures.length === 1 || !signed.hash
              ? this.signatures[0]!
              : sortSigs(this.signatures, signed.hash)
        }

        if (this.messageToSign.content.kind === 'typedMessage') {
          if (isAmbireOperationTypedData(this.messageToSign.content)) {
            throw new Error(AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE)
          }

          if (this.#account.creation && this.messageToSign.content.primaryType === 'Permit') {
            throw new Error(
              'It looks like that this app doesn\'t detect Smart Account wallets, and requested incompatible approval type. Please, go back to the app and change the approval type to "Transaction", which is supported by Smart Account wallets.'
            )
          }

          const signed = await getEIP712Signature(
            this.messageToSign.content,
            this.#account,
            accountState,
            this.signer,
            this.network,
            this.#invite.isOG,
            (request, sign) => this.#withHardwareWalletSigningRequest(request, sign)
          )
          this.signatures.push(signed.signature)
          this.signed.push(signerKey.addr)

          if (accountState.threshold > 1) {
            if (!!this.#account.safeCreation && signed.hash) {
              this.hash = signed.hash
              if (this.signed.length === 1) {
                await this.addMsgToSafeGlobal(
                  signed.signature,
                  this.messageToSign.content as EIP712TypedData
                )
              } else {
                await this.addSigToSafeGlobal(signed.signature, signed.hash)
              }
            }
          }

          if (!this.#isSigningOperationValidAfterAsyncOperation(signingGeneration)) return

          signature =
            this.signatures.length === 1 || !signed.hash
              ? this.signatures[0]!
              : sortSigs(this.signatures, signed.hash)
        }

        if (this.messageToSign.content.kind === 'authorization-7702') {
          // TODO: Deprecated. Sync with the latest sign7702 method changes if used
          // signature = this.signer.sign7702(this.messageToSign.content.message)
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

      // skip the message verification for safe accounts & EOAs. Reasons:
      // * for EOAs: bcz it's a privacy issue
      // * for Safes: bcz the Safe API will return an error on invalid sig
      if (!this.#account.safeCreation && !accountState.isEOA) {
        const verifyMessageParams = {
          provider,
          // the signer is always the account even if the actual
          // signature is from a key that has privs to the account
          signer: this.messageToSign.accountAddr,
          signature: getVerifyMessageSignature(signature, this.#account, accountState),

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
        if (!this.#isSigningOperationValidAfterAsyncOperation(signingGeneration)) return

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

  /**
   * Unbrick mechanism.
   * Use this only when you are sure there's no way to continue, or
   * a promise waiting to resolve that might change the state
   */
  cancelSignReq() {
    this.statuses.sign = 'INITIAL'
    this.hardwareWalletSigningRequest = null
    this.emitUpdate()
  }

  #onAbortOperation() {
    if (this.signer?.signingCleanup) {
      void this.signer.signingCleanup()
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

  #getDappVerificationBanner(): DappVerificationBanner | null {
    if (!this.#dapps || !this.dapp?.url) return null

    const banner = this.#dapps.getDappVerificationBanner([this.dapp.url.toLowerCase()], {
      // SignMessage operates on a single dApp, and the request window already shows it,
      // so repeating the dApp name in the banner text adds noise.
      includeDappNamesInText: false,
      sessionId: this.dapp.sessionId
    })
    if (!banner) return null
    // In the SignMessage flow, "not in catalog" is too noisy and not actionable enough on its own.
    if (banner.id === DAPP_VERIFICATION_BANNER_IDS.NOT_IN_CATALOG) return null

    return banner
  }

  get banners(): DappVerificationBanner[] {
    const banner = this.#getDappVerificationBanner()
    if (!banner) return []

    return [banner]
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      banners: this.banners
    }
  }
}
