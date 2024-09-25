import { Fetch } from '../../interfaces/fetch'
import { SocketAPIToken } from '../../interfaces/swapAndBridge'
import { isSmartAccount } from '../../libs/account/account'
import { TokenResult } from '../../libs/portfolio'
import { SocketAPI } from '../../services/socket/api'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'

export class SwapAndBridgeController extends EventEmitter {
  #accounts: AccountsController

  #socketAPI: SocketAPI

  fromChainId: number | null = 1

  fromSelectedToken: TokenResult | null = null

  fromAmount: string = ''

  toChainId: number | null = 10

  toSelectedToken: SocketAPIToken | null = null

  quote: any = null // TODO: Define type

  toTokenList: SocketAPIToken[] = []

  constructor({ fetch, accounts }: { fetch: Fetch; accounts: AccountsController }) {
    super()
    this.#accounts = accounts
    this.#socketAPI = new SocketAPI({ fetch })

    this.emitUpdate()
  }

  init() {
    this.reset()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.updateToTokenList(false)
  }

  update({
    fromAmount,
    fromChainId,
    fromSelectedToken,
    toChainId,
    toSelectedToken
  }: {
    fromAmount?: string
    fromChainId?: bigint | number
    fromSelectedToken?: TokenResult | null
    toChainId?: number | null
    toSelectedToken?: SocketAPIToken | null
  }) {
    if (fromAmount !== undefined) {
      this.fromAmount = fromAmount
    }

    if (fromChainId) {
      this.fromChainId = Number(fromChainId)
      this.toTokenList = []
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateToTokenList(true)
    }

    if (fromSelectedToken) {
      this.fromSelectedToken = fromSelectedToken
    }

    if (toChainId) {
      this.toChainId = Number(toChainId)
      this.toTokenList = []
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateToTokenList(true)
    }

    if (toSelectedToken) {
      this.toSelectedToken = toSelectedToken
    }

    this.emitUpdate()
  }

  reset() {
    this.fromChainId = 1
    this.fromSelectedToken = null
    this.fromAmount = ''
    this.toChainId = 10
    this.toSelectedToken = null
    this.quote = null

    this.emitUpdate()
  }

  async updateToTokenList(shouldReset: boolean) {
    if (!this.fromChainId || !this.toChainId) return

    if (shouldReset) {
      this.toTokenList = []
      this.emitUpdate()
    }

    this.toTokenList = await this.#socketAPI.getToTokenList({
      fromChainId: this.fromChainId,
      toChainId: this.toChainId
    })
    this.emitUpdate()
  }

  async updateQuote() {
    if (
      this.fromChainId === null ||
      this.toChainId === null ||
      this.fromSelectedToken === null ||
      this.toSelectedToken === null ||
      this.#accounts.selectedAccount === null
    )
      return // TODO: Throw meaningful error if any of the required fields are null

    const selectedAccount = this.#accounts.accounts.find(
      (a) => a.addr === this.#accounts.selectedAccount
    )
    this.quote = await this.#socketAPI.quote({
      fromChainId: this.fromChainId,
      fromTokenAddress: this.fromSelectedToken.address,
      toChainId: this.toChainId,
      toTokenAddress: this.toSelectedToken,
      fromAmount: this.fromAmount,
      userAddress: this.#accounts.selectedAccount,
      isSmartAccount: isSmartAccount(selectedAccount)
    })
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
