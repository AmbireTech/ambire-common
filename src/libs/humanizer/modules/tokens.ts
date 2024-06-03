import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, HumanizerPromise, IrCall } from '../interfaces'
import {
  getAction,
  getAddressVisualization,
  getKnownToken,
  getLabel,
  getNft,
  getToken,
  getTokenInfo,
  getUnknownVisualization
} from '../utils'

const ERC20 = [
  'function name() view returns (string)',
  'function approve(address _spender, uint256 _value) returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function transferFrom(address _from, address _to, uint256 _value) returns (bool)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address _owner) view returns (uint256 balance)',
  'function symbol() view returns (string)',
  'function transfer(address _to, uint256 _value) returns (bool)',
  'function allowance(address _owner, address _spender) view returns (uint256)'
]

const ERC721 = [
  'function BAYC_PROVENANCE() view returns (string)',
  'function MAX_APES() view returns (uint256)',
  'function REVEAL_TIMESTAMP() view returns (uint256)',
  'function apePrice() view returns (uint256)',
  'function approve(address to, uint256 tokenId)',
  'function balanceOf(address owner) view returns (uint256)',
  'function baseURI() view returns (string)',
  'function emergencySetStartingIndexBlock()',
  'function flipSaleState()',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function maxApePurchase() view returns (uint256)',
  'function mintApe(uint256 numberOfTokens) payable',
  'function name() view returns (string)',
  'function owner() view returns (address)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function renounceOwnership()',
  'function reserveApes()',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes _data)',
  'function saleIsActive() view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function setBaseURI(string baseURI)',
  'function setProvenanceHash(string provenanceHash)',
  'function setRevealTimestamp(uint256 revealTimeStamp)',
  'function setStartingIndex()',
  'function startingIndex() view returns (uint256)',
  'function startingIndexBlock() view returns (uint256)',
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
  'function symbol() view returns (string)',
  'function tokenByIndex(uint256 index) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function transferOwnership(address newOwner)',
  'function withdraw()'
]
export const genericErc721Humanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  humanizerMeta: HumanizerMeta
) => {
  const iface = new Interface(ERC721)
  const nftTransferVisualization = (call: IrCall) => {
    const args = iface.parseTransaction(call)?.args.toArray() || []
    return args[0] === accountOp.accountAddr
      ? [
          getAction('Send'),
          getNft(call.to, args[2]),
          getLabel('to'),
          getAddressVisualization(args[1])
        ]
      : [
          getAction('Transfer'),
          getNft(call.to, args[2]),
          getLabel('from'),
          getAddressVisualization(args[0]),
          getLabel('to'),
          getAddressVisualization(args[1])
        ]
  }
  const matcher = {
    [iface.getFunction('approve')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[0] === ZeroAddress
        ? [getAction('Revoke approval'), getLabel('for'), getNft(call.to, args[1])]
        : [
            getAction('Grant approval'),
            getLabel('for'),
            getNft(call.to, args[1]),
            getLabel('to'),
            getAddressVisualization(args[0])
          ]
    },
    [iface.getFunction('setApprovalForAll')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[1]
        ? [
            getAction('Grant approval'),
            getLabel('for all nfts'),
            getNft(call.to, args[1]),
            getLabel('to'),
            getAddressVisualization(args[0])
          ]
        : [getAction('Revoke approval'), getLabel('for all nfts'), getAddressVisualization(args[0])]
    },
    // not in tests
    [iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256'])?.selector!]:
      nftTransferVisualization,
    // [`${
    //   iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256', 'bytes'])
    //     ?.selector
    // }`]: nftTransferVisualization,
    [iface.getFunction('transferFrom', ['address', 'address', 'uint256'])?.selector!]:
      nftTransferVisualization
  }

  const newCalls = currentIrCalls.map((call) => {
    // the humanizer works like this:
    // first, humanize ERC-20
    // second, humanize ERC-721
    // but the sigHash for approve is the same on both standards
    // so on approve, ERC-20 humanization is replaced by ERC-721.
    // that's why we check if it's a known token to prevent humanization.
    // If it's not a known token, using the same humanization is okay as
    // we cannot humanize it further
    const isActuallyKnownToken = !!getKnownToken(humanizerMeta, call.to)
    // could do additional check if it is actually NFT contract
    return matcher[call.data.substring(0, 10)] && !isActuallyKnownToken
      ? {
          ...call,
          fullVisualization: matcher[call.data.substring(0, 10)](call)
        }
      : call
  })
  return [newCalls, []]
}

export const genericErc20Humanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  humanizerMeta: HumanizerMeta,
  options?: any
) => {
  const asyncOps: HumanizerPromise[] = []
  const iface = new Interface(ERC20)
  const matcher = {
    [iface.getFunction('approve')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return args[1] !== BigInt(0)
        ? [
            getAction('Grant approval'),
            getLabel('for'),
            getToken(call.to, args[1]),
            getLabel('to'),
            getAddressVisualization(args[0])
          ]
        : [
            getAction('Revoke approval'),
            getToken(call.to, args[1]),
            getLabel('for'),
            getAddressVisualization(args[0])
          ]
    },
    [iface.getFunction('transfer')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      return [
        getAction('Send'),
        getToken(call.to, args[1]),
        getLabel('to'),
        getAddressVisualization(args[0])
      ]
    },
    [iface.getFunction('transferFrom')?.selector!]: (call: IrCall) => {
      const args = iface.parseTransaction(call)?.args.toArray() || []
      if (args[0] === accountOp.accountAddr) {
        return [
          getAction('Transfer'),
          getToken(call.to, args[2]),
          getLabel('to'),
          getAddressVisualization(args[1])
        ]
      }
      if (args[1] === accountOp.accountAddr) {
        return [
          getAction('Take'),
          getToken(call.to, args[2]),
          getLabel('from'),
          getAddressVisualization(args[0])
        ]
      }
      return [
        getAction('Move'),
        getToken(call.to, args[2]),
        getLabel('from'),
        getAddressVisualization(args[0]),
        getLabel('to'),
        getAddressVisualization(args[1])
      ]
    }
  }
  const newCalls = currentIrCalls.map((call) => {
    const sigHash = call.data.substring(0, 10)
    const isToKnownToken = !!getKnownToken(humanizerMeta, call.to)
    // if proper func selector and no such token found in meta
    // console.log(matcher[sigHash], isToKnownToken)
    if (matcher[sigHash] && !isToKnownToken)
      asyncOps.push(() => getTokenInfo(accountOp, call.to, options))

    if (matcher[sigHash] && isToKnownToken)
      return {
        ...call,
        fullVisualization: matcher[sigHash](call)
      }

    if (isToKnownToken && !matcher[sigHash])
      return {
        ...call,
        fullVisualization: getUnknownVisualization('ERC-20', call)
      }
    return call
  })
  return [newCalls, asyncOps]
}
