import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { formatUnits, Interface, parseUnits } from 'ethers'

import { HumanizerInfoType } from '../../../v1/hooks/useConstants'
import { networks } from '../../consts/networks'
import { UserRequest } from '../../interfaces/userRequest'
import { TokenResult } from '../../libs/portfolio'
import { isKnownTokenOrContract } from '../../services/address'
import { getBip44Items, resolveENSDomain } from '../../services/ensDomains'
import { resolveUDomain } from '../../services/unstoppableDomains'
import EventEmitter from '../eventEmitter'

const ERC20 = new Interface(erc20Abi)

const getTokenAddressAndNetworkFromId = (id: string) => {
  const [address, networkId] = id.split('-')
  return [address, networkId]
}

/**
 * Represents a book.
 * @constructor
 * @param {string} storage - Reference to storage.
 */
export class TransferController extends EventEmitter {
  // State
  amount: string = '0'

  maxAmount: string = '0'

  recipientAddress: string = ''

  recipientEnsAddress: string = ''

  tokens: TokenResult[] = []

  recipientUDAddress: string = ''

  selectedAsset: TokenResult | null = null

  isRecipientAddressUnknown: boolean = false

  isRecipientSmartContract: boolean = false

  isRecipientSWRestricted: boolean = false

  userRequest: UserRequest | null = null

  #selectedAssetNetworkData: {
    id: string
    unstoppableDomainsChain: string
  } | null = null

  #selectedAccount: string | null = null

  #humanizerInfo: HumanizerInfoType | null = null

  async init({
    selectedAccount,
    preSelectedAsset,
    // The old humanizer from ambire-constants. @TODO: replace it with the new one?
    humanizerInfo,
    tokens
  }: {
    selectedAccount: string
    preSelectedAsset?: string
    humanizerInfo: HumanizerInfoType
    tokens: TokenResult[]
  }) {
    if (!humanizerInfo)
      throw new Error('Invalid humanizerInfo value during TransferController init.')
    if (!selectedAccount)
      throw new Error('Invalid selectedAccount value during TransferController init.')

    this.#humanizerInfo = humanizerInfo
    this.#selectedAccount = selectedAccount

    this.tokens = tokens.filter((token) => token.amount !== 0n)

    if (preSelectedAsset) {
      this.handleAssetChange(preSelectedAsset)
    } else if (!preSelectedAsset && this.tokens.length > 0) {
      const firstToken = this.tokens[0]
      const firstTokenAddressAndNetwork = `${firstToken.address}-${firstToken.networkId}`

      this.handleAssetChange(firstTokenAddressAndNetwork)
    }
    this.emitUpdate()
  }

  reset() {
    this.amount = '0'
    this.recipientAddress = ''
    this.recipientEnsAddress = ''
    this.recipientUDAddress = ''
    this.selectedAsset = this.tokens[0]
    this.#selectedAssetNetworkData = null
    this.userRequest = null
    this.isRecipientAddressUnknown = true
    this.isRecipientSmartContract = false
    this.isRecipientSWRestricted = false

    this.emitUpdate()
  }

  async buildUserRequest() {
    const recipientAddress =
      this.recipientUDAddress || this.recipientEnsAddress || this.recipientAddress

    if (!this.selectedAsset || !this.#selectedAssetNetworkData || !this.#selectedAccount) return

    const bigNumberHexAmount = `0x${parseUnits(
      this.amount,
      Number(this.selectedAsset.decimals)
    ).toString(16)}`

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
      networkId: this.#selectedAssetNetworkData.id,
      accountAddr: this.#selectedAccount,
      forceNonce: null,
      action: txn
    }

    this.userRequest = req

    this.emitUpdate()
  }

  setRecipientAddress(address: string) {
    this.recipientAddress = address.trim()
    this.emitUpdate()
  }

  // Allows for debounce implementation in the UI
  async onRecipientAddressChange() {
    const address = this.recipientAddress.trim()
    const canBeEnsOrUd = !address.startsWith('0x') || address.indexOf('.') !== -1

    if (!canBeEnsOrUd) {
      if (this.recipientUDAddress) this.recipientUDAddress = ''
      if (this.recipientEnsAddress) this.recipientEnsAddress = ''
    }

    if (this.selectedAsset?.networkId && this.#selectedAssetNetworkData && canBeEnsOrUd) {
      this.recipientUDAddress = await resolveUDomain(
        address,
        this.selectedAsset.symbol,
        this.#selectedAssetNetworkData.unstoppableDomainsChain
      )

      const bip44Item = getBip44Items(this.selectedAsset.symbol)
      this.recipientEnsAddress = await resolveENSDomain(address, bip44Item)
    }
    if (this.#humanizerInfo) {
      this.isRecipientSmartContract = isKnownTokenOrContract(this.#humanizerInfo, address)
    }

    const isRecipientAddressValid = !!this.selectedAsset?.address
    this.isRecipientSWRestricted =
      isRecipientAddressValid &&
      Number(this.selectedAsset?.address) === 0 &&
      networks
        .map(({ id }) => id)
        .filter((id) => id !== 'ethereum')
        .includes(this.#selectedAssetNetworkData?.id || 'ethereum')

    if (this.recipientUDAddress || this.recipientEnsAddress) {
      this.isRecipientAddressUnknown = true // @TODO: check from the address book
    }

    this.isRecipientAddressUnknown = true // @TODO: isValidAddress & check from the address book
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

  handleAssetChange(assetAddressAndNetwork: string) {
    const [selectedAssetAddress, selectedAssetNetwork] =
      getTokenAddressAndNetworkFromId(assetAddressAndNetwork)

    const matchingToken =
      this.tokens.find(
        ({ address: tokenAddress, networkId: tokenNetworkId }) =>
          tokenAddress === selectedAssetAddress && tokenNetworkId === selectedAssetNetwork
      ) || this.tokens[0]

    const { amount: matchingAssetAmount, decimals } = matchingToken

    this.selectedAsset = matchingToken
    this.#selectedAssetNetworkData =
      networks.find(({ id }) => id === matchingToken.networkId) || null
    this.amount = '0'
    this.maxAmount = formatUnits(matchingAssetAmount, Number(decimals))

    this.emitUpdate()
  }
}
