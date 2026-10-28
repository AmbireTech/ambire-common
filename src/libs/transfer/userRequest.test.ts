import { Interface } from 'ethers'

import IERC721 from '../../../contracts/compiled/IERC721.json'
import { TransferNft } from '../../interfaces/transfer'
import { PaymasterService } from '../erc7677/types'
import { getNftTransferRequestParams } from './userRequest'

const ERC721 = new Interface(IERC721.abi)

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
