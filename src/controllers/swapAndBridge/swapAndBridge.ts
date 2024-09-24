import { Fetch } from '../../interfaces/fetch'
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

  toSelectedToken: TokenResult | null = null

  quote: any = null // TODO: Define type

  toTokenList: {
    address: TokenResult['address']
    chainId: number
    decimals: number
    logoURI: string
    name: string
    symbol: string
  }[] = []

  fromTokenList: {
    address: TokenResult['address']
    chainId: number
    decimals: number
    logoURI: string
    name: string
    symbol: string
  }[] = []

  constructor({ fetch, accounts }: { fetch: Fetch; accounts: AccountsController }) {
    super()
    this.#accounts = accounts
    this.#socketAPI = new SocketAPI({ fetch })

    this.emitUpdate()
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
    toSelectedToken?: TokenResult | null
  }) {
    if (fromAmount !== undefined) {
      this.fromAmount = fromAmount
    }

    if (fromChainId) {
      this.fromChainId = Number(fromChainId)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateToTokenList()
    }

    if (fromSelectedToken) {
      this.fromSelectedToken = fromSelectedToken
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateToTokenList()
    }

    if (toChainId) {
      this.toChainId = Number(toChainId)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateFromTokenList()
    }

    if (toSelectedToken) {
      this.toSelectedToken = toSelectedToken
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.updateFromTokenList()
    }

    this.emitUpdate()
  }

  async updateToTokenList() {
    if (!this.fromChainId || !this.toChainId) return

    this.toTokenList = await this.#socketAPI.getToTokenList({
      fromChainId: this.fromChainId,
      toChainId: this.toChainId
    })
    this.emitUpdate()
  }

  async updateFromTokenList() {
    if (!this.fromChainId) return

    this.fromTokenList = await this.#socketAPI.getFromTokenList({
      fromChainId: this.fromChainId
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
      toTokenAddress: this.toSelectedToken.address,
      fromAmount: this.fromAmount,
      userAddress: this.#accounts.selectedAccount,
      isSmartAccount: isSmartAccount(selectedAccount)
    })
    this.emitUpdate()
  }

  toJSON() {
    return {
      ...this
    }
  }
}
