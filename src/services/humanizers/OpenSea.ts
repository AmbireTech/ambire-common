// TODO: add types
// @ts-nocheck

import { Interface } from 'ethers/lib/utils'

import { HumanizerInfoType } from '../../hooks/useConstants'
import { nativeToken, token } from '../humanReadableTransactions'

const partialOpenSeaAbi = [
  {
    inputs: [
      { internalType: 'address', name: 'nftContract', type: 'address' },
      { internalType: 'address', name: 'feeRecipient', type: 'address' },
      { internalType: 'address', name: 'minterIfNotPayer', type: 'address' },
      { internalType: 'uint256', name: 'quantity', type: 'uint256' }
    ],
    name: 'mintPublic',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  }
]

const OpenSeaMapping = (humanizerInfo: HumanizerInfoType) => {
  const WyvernExchange = new Interface(humanizerInfo.abis.WyvernExchange)
  const OpenSeaInterface = new Interface(partialOpenSeaAbi)

  return {
    [WyvernExchange.getSighash('atomicMatch_')]: (txn, network, { extended = false }) => {
      const { addrs, uints } = WyvernExchange.parseTransaction(txn).args
      const seller = addrs[1]
      const tokenAddress = addrs[6]
      const price = uints[4]
      const paymentToken =
        Number(tokenAddress) === 0
          ? nativeToken(network, price, true)
          : token(humanizerInfo, tokenAddress, price, true)
      return !extended
        ? [`Buy nft from ${seller} for ${price} ETH on OpenSea`]
        : [
            [
              'Buy',
              'nft from',
              {
                type: 'address',
                address: seller
              },
              'for',
              {
                type: 'token',
                ...paymentToken
              },
              'on OpenSea'
            ]
          ]
    },
    [WyvernExchange.getSighash('approveOrder_')]: (txn, network, { extended = false }) => {
      const { addrs, uints } = WyvernExchange.parseTransaction(txn).args
      const collection = addrs[4]
      const tokenAddress = addrs[6]
      const price = uints[4]
      const paymentToken =
        Number(tokenAddress) === 0
          ? nativeToken(network, price, true)
          : token(humanizerInfo, tokenAddress, price, true)
      return !extended
        ? [`Approve to submit an order of ${price} WETH to buy bft from ${collection} on OpenSea`]
        : [
            [
              'Approve',
              'to submit an order of',
              {
                type: 'token',
                ...paymentToken
              },
              'to buy nft from',
              {
                type: 'address',
                address: collection
              },
              'on OpenSea'
            ]
          ]
    },
    [OpenSeaInterface.getSighash('mintPublic')]: (txn, network, { extended = false }) => {
      const { nftContract, feeRecipient, minterIfNotPayer, quantity } =
        OpenSeaInterface.parseTransaction(txn).args

      return !extended
        ? [`Mint ${quantity} NFT${quantity > 1 ? 's' : ''} on ${network}`]
        : [['Mint', `${quantity} NFT${quantity > 1 ? 's' : ''}`, 'on OpenSea']]
    }
  }
}
export default OpenSeaMapping