import { Fetch } from '../../interfaces/fetch'
import { isSmartAccount } from '../../libs/account/account'
import { TokenResult } from '../../libs/portfolio'
import { SocketAPI } from '../../services/socket/api'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'

export class SwapAndBridgeController extends EventEmitter {
  #accounts: AccountsController

  #socketAPI: SocketAPI

  fromChainId: number | null = 1 // temporary hardcoded as default

  fromSelectedToken: TokenResult | null

  fromAmount: string = ''

  toTokenAddress: TokenResult['address'] | null = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' // temporary hardcoded as default (USDC)

  toChainId: number | null = 1 // temporary hardcoded as default

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
    fromSelectedToken
  }: {
    fromAmount?: string
    fromChainId?: bigint | number
    fromSelectedToken?: TokenResult | null
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

    this.emitUpdate()
  }

  async updateFromToken({
    fromTokenAddress,
    fromChainId
  }: {
    fromTokenAddress: TokenResult['address']
    fromChainId: number
  }) {
    this.fromTokenAddress = fromTokenAddress
    this.fromChainId = fromChainId
    this.emitUpdate()

    await this.updateToTokenList()
  }

  async updateToChainId(toChainId: number) {
    this.toChainId = toChainId
    this.emitUpdate()

    await this.updateToTokenList()
  }

  async updateToTokenAddress(toTokenAddress: TokenResult['address']) {
    this.toTokenAddress = toTokenAddress
    this.emitUpdate()

    await this.updateQuote()
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
      this.fromTokenAddress === null ||
      this.toTokenAddress === null ||
      this.#accounts.selectedAccount === null
    )
      return // TODO: Throw meaningful error if any of the required fields are null

    const selectedAccount = this.#accounts.accounts.find(
      (a) => a.addr === this.#accounts.selectedAccount
    )
    this.quote = await this.#socketAPI.quote({
      fromChainId: this.fromChainId,
      fromTokenAddress: this.fromTokenAddress,
      toChainId: this.toChainId,
      toTokenAddress: this.toTokenAddress,
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
