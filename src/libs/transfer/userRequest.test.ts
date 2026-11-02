import { Interface, ZeroAddress } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import IERC721 from '../../../contracts/compiled/IERC721.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { TransferNft } from '../../interfaces/transfer'
import { PaymasterService } from '../erc7677/types'
import { TokenResult } from '../portfolio'
import { getNftTransferRequestParams, getTransferRequestParams } from './userRequest'

const ERC20 = new Interface(IERC20.abi)
const ERC721 = new Interface(IERC721.abi)

const ACCOUNT_ADDR = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const RECIPIENT_ADDR = '0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA'
const ETHEREUM_CHAIN_ID = 1n
const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
// Ink - not a predefined network, so it has no known wrapped native token
const CUSTOM_CHAIN_ID = 57073n
const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const getToken = (overrides: Partial<TokenResult>): TokenResult => ({
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  address: ZeroAddress,
  chainId: ETHEREUM_CHAIN_ID,
  amount: 10n ** 18n,
  priceIn: [],
  marketDataIn: [],
  flags: { onGasTank: false, rewardsType: null, canTopUpGasTank: true, isFeeToken: true },
  ...overrides
})

const AMOUNT_IN_FIAT = 3_000_000_000n

describe('getTransferRequestParams', () => {
  test('should send a native transfer to a regular recipient directly', () => {
    const result = getTransferRequestParams({
      amount: '1',
      amountInFiat: AMOUNT_IN_FIAT,
      selectedToken: getToken({}),
      selectedAccount: ACCOUNT_ADDR,
      recipientAddress: RECIPIENT_ADDR,
      recipientDomain: undefined
    })

    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(1)
    expect(result!.calls[0]!.to).toBe(RECIPIENT_ADDR.toLowerCase())
    expect(result!.calls[0]!.value).toBe(10n ** 18n)
    expect(result!.calls[0]!.data).toBe('0x')
    expect(result!.meta.topUpAmount).toBeUndefined()
  })

  test('should wrap the native token for a top up on a predefined network', () => {
    const result = getTransferRequestParams({
      amount: '1',
      amountInFiat: AMOUNT_IN_FIAT,
      selectedToken: getToken({}),
      selectedAccount: ACCOUNT_ADDR,
      recipientAddress: FEE_COLLECTOR,
      recipientDomain: undefined
    })

    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(2)
    expect(result!.calls[0]!.to).toBe(WETH_ETHEREUM)
    expect(result!.calls[0]!.value).toBe(10n ** 18n)
    expect(result!.calls[1]!.to).toBe(WETH_ETHEREUM)
    expect(result!.calls[1]!.value).toBe(0n)
    expect(result!.calls[1]!.data).toBe(
      ERC20.encodeFunctionData('transfer', [FEE_COLLECTOR.toLowerCase(), 10n ** 18n])
    )
    expect(result!.meta.topUpAmount).toBe(AMOUNT_IN_FIAT)
  })

  test('should send a native transfer to the fee collector on a network without a known wrapped token', () => {
    const result = getTransferRequestParams({
      amount: '0.5',
      amountInFiat: AMOUNT_IN_FIAT,
      selectedToken: getToken({ chainId: CUSTOM_CHAIN_ID }),
      selectedAccount: ACCOUNT_ADDR,
      recipientAddress: FEE_COLLECTOR,
      recipientDomain: undefined
    })

    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(1)
    expect(result!.calls[0]!.to).toBe(FEE_COLLECTOR.toLowerCase())
    expect(result!.calls[0]!.value).toBe(5n * 10n ** 17n)
    expect(result!.calls[0]!.data).toBe('0x')
    expect(result!.meta.chainId).toBe(CUSTOM_CHAIN_ID)
    // the transfer isn't recorded as a top up, so it must not be counted towards the gas tank
    expect(result!.meta.topUpAmount).toBeUndefined()
  })

  test('should count an ERC-20 transfer to the fee collector as a top up', () => {
    const result = getTransferRequestParams({
      amount: '10',
      amountInFiat: AMOUNT_IN_FIAT,
      selectedToken: getToken({ symbol: 'USDC', decimals: 6, address: USDC_ETHEREUM }),
      selectedAccount: ACCOUNT_ADDR,
      recipientAddress: FEE_COLLECTOR,
      recipientDomain: undefined
    })

    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(1)
    expect(result!.calls[0]!.to).toBe(USDC_ETHEREUM)
    expect(result!.calls[0]!.data).toBe(
      ERC20.encodeFunctionData('transfer', [FEE_COLLECTOR.toLowerCase(), 10_000_000n])
    )
    expect(result!.meta.topUpAmount).toBe(AMOUNT_IN_FIAT)
  })

  test('should return null when the recipient is missing', () => {
    expect(
      getTransferRequestParams({
        amount: '1',
        selectedToken: getToken({}),
        selectedAccount: ACCOUNT_ADDR,
        recipientAddress: '',
        recipientDomain: undefined
      })
    ).toBeNull()
  })
})

const ACCOUNT = '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
const RECIPIENT = '0xC89B38119C58536d818f3Bf19a9E3870828C1994'
const NFT: TransferNft = {
  address: '0x59468516a8259058bAd1cA5F8f4BFF190d30E066',
  chainId: 1n,
  tokenId: 1234n,
  collectionName: 'Test collection'
}

describe('getNftTransferRequestParams', () => {
  test('should build a single safeTransferFrom call to the NFT collection', () => {
    const result = getNftTransferRequestParams({
      nft: NFT,
      selectedAccount: ACCOUNT,
      recipientAddress: RECIPIENT,
      recipientDomain: 'recipient.eth'
    })

    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(1)

    const [call] = result!.calls
    expect(call!.to).toBe(NFT.address)
    expect(call!.value).toBe(0n)
    expect(call!.recipientDomain).toBe('recipient.eth')

    const decoded = ERC721.parseTransaction({ data: call!.data })
    expect(decoded!.signature).toBe('safeTransferFrom(address,address,uint256)')
    expect(decoded!.args[0]).toBe(ACCOUNT)
    expect(decoded!.args[1]).toBe(RECIPIENT)
    expect(decoded!.args[2]).toBe(NFT.tokenId)
  })

  test('should set the meta to the NFT chain and the sending account', () => {
    const paymasterService: PaymasterService = { url: 'https://paymaster.example', id: '1' }
    const result = getNftTransferRequestParams({
      nft: NFT,
      selectedAccount: ACCOUNT,
      recipientAddress: RECIPIENT,
      recipientDomain: undefined,
      paymasterService
    })

    expect(result!.meta).toEqual({
      chainId: NFT.chainId,
      accountAddr: ACCOUNT,
      paymasterService
    })
  })

  test('should never use the unsafe transferFrom', () => {
    const result = getNftTransferRequestParams({
      nft: NFT,
      selectedAccount: ACCOUNT,
      recipientAddress: RECIPIENT,
      recipientDomain: undefined
    })
    const transferFromSelector = ERC721.getFunction('transferFrom')!.selector

    expect(result!.calls[0]!.data.startsWith(transferFromSelector)).toBe(false)
  })

  test('should encode token ids bigger than Number.MAX_SAFE_INTEGER without losing precision', () => {
    const hugeTokenId = 2n ** 255n + 7n
    const result = getNftTransferRequestParams({
      nft: { ...NFT, tokenId: hugeTokenId },
      selectedAccount: ACCOUNT,
      recipientAddress: RECIPIENT,
      recipientDomain: undefined
    })

    const decoded = ERC721.parseTransaction({ data: result!.calls[0]!.data })
    expect(decoded!.args[2]).toBe(hugeTokenId)
  })

  test('should refuse to send the NFT to its own collection contract (case-insensitive)', () => {
    expect(
      getNftTransferRequestParams({
        nft: NFT,
        selectedAccount: ACCOUNT,
        recipientAddress: NFT.address.toLowerCase(),
        recipientDomain: undefined
      })
    ).toBeNull()
  })

  test('should refuse an invalid recipient', () => {
    expect(
      getNftTransferRequestParams({
        nft: NFT,
        selectedAccount: ACCOUNT,
        recipientAddress: 'vitalik.eth',
        recipientDomain: undefined
      })
    ).toBeNull()
    expect(
      getNftTransferRequestParams({
        nft: NFT,
        selectedAccount: ACCOUNT,
        recipientAddress: '',
        recipientDomain: undefined
      })
    ).toBeNull()
  })

  test('should refuse an invalid sending account', () => {
    expect(
      getNftTransferRequestParams({
        nft: NFT,
        selectedAccount: '',
        recipientAddress: RECIPIENT,
        recipientDomain: undefined
      })
    ).toBeNull()
  })
})
