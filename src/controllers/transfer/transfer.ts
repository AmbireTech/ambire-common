import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { networks } from 'consts/networks'
import EventEmitter from 'controllers/eventEmitter'
import { PortfolioController } from 'controllers/portfolio/portfolio'
import { formatUnits, Interface, parseUnits } from 'ethers'
import { Storage } from 'interfaces/storage'
import { UserRequest } from 'interfaces/userRequest'
import { TokenResult } from 'libs/portfolio'
import { isKnownTokenOrContract, isValidAddress } from 'services/address'
import { getBip44Items, resolveENSDomain } from 'services/ensDomains'
import { resolveUDomain } from 'services/unstoppableDomains'

const ERC20 = new Interface(erc20Abi)

const getTokenAddressAndNetworkFromId = (id: string) => {
  const [address, networkId] = id.split('-')
  return [address, networkId]
}

export class TransferController extends EventEmitter {
  // State
  amount: string = '0'
  maxAmount: string = '0'
  recipientAddress: string = ''
  ensAddress: string = ''
  uDAddress: string = ''
  selectedAsset?: TokenResult
  selectedAssetNetworkData?: {
    id: string
    unstoppableDomainsChain: string
  }
  userRequest: UserRequest | null = null
  // @TODO:
  isRecipientUnknownAddress: boolean = false
  isRecipientSmartContract: boolean = false
  isRecipientSWRestricted: boolean = false

  #humanizerInfo: any = null
  // Controllers
  #storage: Storage

  constructor({ storage }: { storage: Storage }) {
    super()
    // Will be used for storing the user's address book
    this.#storage = storage
  }

  init({
    preSelectedAsset,
    tokens,
    humanizerInfo
  }: {
    preSelectedAsset?: string
    tokens: TokenResult[]
    humanizerInfo: any
  }) {
    this.#humanizerInfo = humanizerInfo
    if (preSelectedAsset) {
      this.handleChangeAsset(tokens, preSelectedAsset)
    } else {
      this.selectedAsset = tokens[0]
    }
    this.emitUpdate()
  }

  reset() {
    this.amount = '0'
    this.maxAmount = '0'
    this.recipientAddress = ''
    this.ensAddress = ''
    this.uDAddress = ''
    this.selectedAsset = undefined
    this.selectedAssetNetworkData = undefined
    this.userRequest = null
    this.isRecipientUnknownAddress = false
    this.isRecipientSmartContract = false
    this.isRecipientSWRestricted = false

    this.emitUpdate()
  }

  async buildUserRequest({ selectedAccount }: { selectedAccount: string }) {
    const recipientAddress = this.uDAddress || this.ensAddress || this.recipientAddress

    if (!this.selectedAsset || !this.selectedAssetNetworkData || !selectedAccount) return

    const bigNumberHexAmount = `0x${parseUnits(this.amount, this.selectedAsset.decimals).toString(
      16
    )}`

    const txn = {
      kind: 'call' as const,
      to: this.selectedAsset.address,
      value: BigInt(0),
      data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
    }

    if (Number(this.selectedAsset.address) === 0) {
      txn.to = recipientAddress
      txn.value = BigInt(bigNumberHexAmount)
      txn.data = '0x'
    }

    const req: UserRequest = {
      id: new Date().getTime(),
      networkId: this.selectedAssetNetworkData.id,
      accountAddr: selectedAccount,
      forceNonce: null,
      action: txn
    }

    this.userRequest = req

    this.emitUpdate()
  }

  async setAddress(address: string) {
    this.recipientAddress = address

    if (address.startsWith('0x') && address.indexOf('.') === -1) {
      if (this.uDAddress !== '') this.uDAddress = ''
      if (this.ensAddress !== '') this.ensAddress = ''
    }

    if (this.selectedAsset?.networkId && this.selectedAssetNetworkData) {
      this.uDAddress = await resolveUDomain(
        address,
        this.selectedAsset.symbol,
        this.selectedAssetNetworkData.unstoppableDomainsChain
      )

      const bip44Item = getBip44Items(this.selectedAsset.symbol)
      this.ensAddress = await resolveENSDomain(address, bip44Item)
    }
    this.isRecipientSmartContract = isKnownTokenOrContract(this.#humanizerInfo, address)

    const isRecipientAddressValid = !!this.selectedAsset?.address
    this.isRecipientSWRestricted =
      isRecipientAddressValid &&
      Number(this.selectedAsset?.address) === 0 &&
      networks
        .map(({ id }) => id)
        .filter((id) => id !== 'ethereum')
        .includes(this.selectedAssetNetworkData?.id || 'ethereum')

    if (this.uDAddress || this.ensAddress) {
      this.isRecipientUnknownAddress = true // check from the address book
    }

    this.isRecipientUnknownAddress = true // isValidAddress & check from the address book

    this.emitUpdate()
  }

  setAmount(amount: string) {
    this.amount = amount
    this.emitUpdate()
  }

  setMaxAmount() {
    this.amount = this.maxAmount
    this.emitUpdate()
  }

  handleChangeAsset = (tokens: TokenResult[], assetAddressAndNetwork: string) => {
    const [selectedAssetAddress, selectedAssetNetwork] =
      getTokenAddressAndNetworkFromId(assetAddressAndNetwork)

    const matchingToken =
      tokens.find(
        ({ address: tokenAddress, networkId: tokenNetworkId }) =>
          tokenAddress === selectedAssetAddress && tokenNetworkId === selectedAssetNetwork
      ) || tokens[0]

    const { amount: matchingAssetAmount, decimals } = matchingToken

    this.selectedAsset = matchingToken
    this.selectedAssetNetworkData = networks.find(({ id }) => id === matchingToken.networkId)
    this.amount = '0'
    this.maxAmount = formatUnits(matchingAssetAmount, decimals)

    this.emitUpdate()
  }
}
