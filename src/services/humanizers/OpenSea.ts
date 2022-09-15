// TODO: add types
// @ts-nocheck

import { HumanizerInfoType } from 'ambire-common/src/hooks/useConstants'
import { Interface } from 'ethers/lib/utils'

import { nativeToken, token } from '../humanReadableTransactions'

const MovrMapping = (humanizerInfo: HumanizerInfoType) => {
  const WyvernExchange = new Interface(humanizerInfo.abis.WyvernExchange)

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
    }
  }
}
export default MovrMapping
