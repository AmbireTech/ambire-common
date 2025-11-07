import { AbiCoder, concat } from 'ethers'
import EmittableError from '../../classes/EmittableError'
import ExternalSignerError from '../../classes/ExternalSignerError'
import { AMBIRE_ACCOUNT_OMNI } from '../../consts/deploy'
import { Account, IAccountsController } from '../../interfaces/account'
import { Statuses } from '../../interfaces/eventEmitter'
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
import { ISignMessageController, SignMessageUpdateParams } from '../../interfaces/signMessage'
import { Message } from '../../interfaces/userRequest'
import {
  get7702Sig,
  getAppFormatted,
  getEIP712Signature,
  getPlainTextSignature,
  getVerifyMessageSignature,
  verifyMessage
} from '../../libs/signMessage/signMessage'
import { get7702SigV } from '../../libs/signMessage/utils'
import { isPlainTextMessage } from '../../libs/transfer/userRequest'
import { getMerkleProof, getMerkleRoot } from '../../libs/userOperation/merkleProofs'
import { getEntryPoint090Hash } from '../../libs/userOperation/userOperation'
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

  signingKeyAddr: Key['addr'] | null = null

  signingKeyType: Key['type'] | null = null

  signedMessage: SignedMessage | null = null

  constructor(
    keystore: IKeystoreController,
    providers: IProvidersController,
    networks: INetworksController,
    accounts: IAccountsController,
    externalSignerControllers: ExternalSignerControllers,
    invite: IInviteController
  ) {
    super()

    this.#keystore = keystore
    this.#providers = providers
    this.#networks = networks
    this.#externalSignerControllers = externalSignerControllers
    this.#accounts = accounts
    this.#invite = invite
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

    if (
      ['message', 'typedMessage', 'authorization-7702', 'siwe', 'signUserOperations'].includes(
        messageToSign.content.kind
      )
    ) {
      if (dapp) this.dapp = dapp
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

    this.#onAbortOperation()
    this.isInitialized = false
    this.dapp = null
    this.messageToSign = null
    this.signedMessage = null
    this.signingKeyAddr = null
    this.signingKeyType = null
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

  setSigningKey(signingKeyAddr: Key['addr'], signingKeyType: Key['type']) {
    this.signingKeyAddr = signingKeyAddr
    this.signingKeyType = signingKeyType
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

    if (!this.signingKeyAddr || !this.signingKeyType) {
      return SignMessageController.#throwMissingSigningKey()
    }

    try {
      this.#signer = await this.#keystore.getSigner(this.signingKeyAddr, this.signingKeyType)
      if (!this.#isSigningOperationValidAfterAsyncOperation()) return

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
        (n: Network) => n.chainId === this.messageToSign!.chainId
      )
      if (!network) {
        throw new Error('Network not supported on Ambire. Please contract support.')
      }

      const accountState = this.#accounts.accountStates[account.addr][network.chainId.toString()]
      let signature

      try {
        if (isPlainTextMessage(this.messageToSign.content)) {
          signature = await getPlainTextSignature(
            this.messageToSign.content.message,
            network,
            account,
            accountState,
            this.#signer,
            this.#invite.isOG
          )
          if (!this.#isSigningOperationValidAfterAsyncOperation()) return
        }

        if (this.messageToSign.content.kind === 'typedMessage') {
          if (account.creation && this.messageToSign.content.primaryType === 'Permit') {
            throw new Error(
              'It looks like that this app doesn\'t detect Smart Account wallets, and requested incompatible approval type. Please, go back to the app and change the approval type to "Transaction", which is supported by Smart Account wallets.'
            )
          }

          signature = await getEIP712Signature(
            this.messageToSign.content,
            account,
            accountState,
            this.#signer,
            network,
            this.#invite.isOG
          )
          if (!this.#isSigningOperationValidAfterAsyncOperation()) return
        }

        if (this.messageToSign.content.kind === 'authorization-7702') {
          // TODO: Deprecated. Sync with the latest sign7702 method changes if used
          // signature = this.#signer.sign7702(this.messageToSign.content.message)
          throw new ExternalSignerError(
            'Signing EIP-7702 authorization via this flow is not implemented',
            { sendCrashReport: true }
          )
        }
        if (this.messageToSign.content.kind === 'signUserOperations') {
          if (!this.#signer.plainSign)
            throw new Error('signer does not support signing multiple user operations')

          const userOps = []
          const hasSigned7702: string[] = []
          const userOpHashes = this.messageToSign.content.chainIdWithUserOps.map(
            (chainIdWithUserOp) =>
              getEntryPoint090Hash(
                chainIdWithUserOp.userOperation,
                BigInt(chainIdWithUserOp.chainId)
              )
          )
          const merkleRoot = getMerkleRoot(0, 0, userOpHashes)
          const merkleSig = this.#signer.plainSign(merkleRoot)
          const merkleSignature = concat([merkleSig.r, merkleSig.s, get7702SigV(merkleSig)]) as Hex
          const coder = new AbiCoder()
          for (let i = 0; i < this.messageToSign.content.chainIdWithUserOps.length; i++) {
            const chainIdWithUserOp = this.messageToSign.content.chainIdWithUserOps[i]
            const chainId = BigInt(chainIdWithUserOp.chainId)

            // find or fetch the account state
            let curAccountState = this.#accounts.accountStates[account.addr][chainId.toString()]
            if (!curAccountState) {
              // eslint-disable-next-line no-await-in-loop
              await this.#accounts.updateAccountState(account.addr, 'pending', [chainId])
              curAccountState = this.#accounts.accountStates[account.addr][chainId.toString()]
            }

            let eip7702Sig = null
            const hasDelegatedToOmni =
              hasSigned7702.indexOf(chainIdWithUserOp.chainId) !== -1 ||
              (curAccountState.isEOA &&
                curAccountState.delegatedContract &&
                curAccountState.delegatedContract.toLowerCase() ===
                  AMBIRE_ACCOUNT_OMNI.toLowerCase())
            if (!hasDelegatedToOmni) {
              hasSigned7702.push(chainIdWithUserOp.chainId)
              // eslint-disable-next-line no-await-in-loop
              eip7702Sig = await this.#signer.sign7702({
                chainId,
                contract: AMBIRE_ACCOUNT_OMNI,
                nonce: curAccountState.eoaNonce!
              })
            }

            const userOp = chainIdWithUserOp.userOperation
            const userOpHash = getEntryPoint090Hash(userOp, chainId)
            const fullSigWithoutWrapping = coder.encode(
              ['uint48', 'uint48', 'bytes32', 'bytes32[]', 'bytes'],
              [0, 0, merkleRoot, getMerkleProof(0, 0, userOpHash, userOpHashes), merkleSignature]
            ) as Hex
            userOp.signature = `${fullSigWithoutWrapping}06`
            userOp.eip7702Auth = eip7702Sig
              ? get7702Sig(chainId, curAccountState.eoaNonce!, AMBIRE_ACCOUNT_OMNI, eip7702Sig)
              : undefined
            userOps.push({
              chainId: chainIdWithUserOp.chainId,
              userOp
            })
          }
          signature = userOps
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

      if (this.messageToSign.content.kind !== 'signUserOperations') {
        const verifyMessageParams = {
          provider: this.#providers.providers[network?.chainId.toString() || '1'],
          // the signer is always the account even if the actual
          // signature is from a key that has privs to the account
          signer: this.messageToSign.accountAddr,
          signature: getVerifyMessageSignature(signature, account, accountState),
          // eslint-disable-next-line no-nested-ternary
          ...(isPlainTextMessage(this.messageToSign.content)
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
            : { authorization: this.messageToSign.content.message })
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
        fromActionId: this.messageToSign.fromActionId,
        accountAddr: this.messageToSign.accountAddr,
        chainId: this.messageToSign.chainId,
        content: this.messageToSign.content,
        timestamp: new Date().getTime(),
        signature: getAppFormatted(signature, account, accountState),
        dapp: this.dapp
      }

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
    const message = 'Please select a signing key and try again.'
    const error = new Error('signMessage: missing selected signing key')

    return Promise.reject(new EmittableError({ level: 'major', message, error }))
  }
}
