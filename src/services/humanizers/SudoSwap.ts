// TODO: add types
// @ts-nocheck

import {Interface} from 'ethers/lib/utils'
import {abis} from '../../constants/humanizerInfo.json'
import {BigNumber} from 'ethers'

import {nativeToken, token} from '../humanReadableTransactions'

const SudoSwapFactory = new Interface(abis.SudoSwapFactory)
const SudoSwapRouter = new Interface(abis.SudoSwapRouter)

const SudoSwapMapping = {
  [SudoSwapFactory.getSighash('createPairETH')]: (txn, network, {extended = false}) => {
    const {_nft} = SudoSwapFactory.parseTransaction(txn).args
    const price = txn.value
    const paymentToken = nativeToken(network, price, true)
    return !extended
      ? [`Make an offer for ${_nft} for ${paymentToken.amount} ETH on SudoSwap`]
      : [
        [
          'Make an offer',
          'for the NFT',
          {
            type: 'erc721',
            address: _nft
          },
          'for',
          {
            type: 'token',
            ...paymentToken
          },
          'on SudoSwap'
        ]
      ]
  },
  [SudoSwapFactory.getSighash('createPairERC20')]: (txn, network, {extended = false}) => {
    const {params} = SudoSwapFactory.parseTransaction(txn).args
    const paymentToken = token(params.token, params.spotPrice, true)

    return !extended
      ? [`Make an offer for ${params.nft} id ${params.initialNFTIDs.join(',')} for ${paymentToken.amount} ${paymentToken.symbol || 'Unknown token'} on SudoSwap`]
      : [
        [
          'Make an offer',
          'for the NFT',
          {
            type: 'erc721',
            address: params.nft
          },
          'for',
          {
            type: 'token',
            ...paymentToken
          },
          'on SudoSwap'
        ]
      ]
  },
  [SudoSwapFactory.getSighash('depositNFTs')]: (txn, network, {extended = false}) => {
    const {_nft, ids} = SudoSwapFactory.parseTransaction(txn).args
    const nfts = ids.map(id => ({address: _nft, id}))
    return !extended
      ? [`Deposit NFT ${_nft} id ${ids.join(',')}`]
      : [
        [
          'Deposit NFT',
          {
            type: 'erc721',
            list: nfts
          },
        ]
      ]
  },

  [SudoSwapRouter.getSighash('swapETHForSpecificNFTs')]: (txn, network, {extended = false}) => {
    const {swapList} = SudoSwapRouter.parseTransaction(txn).args
    const price = txn.value
    const paymentToken = nativeToken(network, price, true)

    if (!extended) return [`Buy NFT from vaults ${swapList.map(i => i[0] + ' #' + i[1]).join(',')} for ${paymentToken.amount} ETH on SudoSwap`]

    let extendedResult = [
      'Buy NFT',
      'from vaults',
    ]

    swapList.forEach(i => {
      extendedResult.push({
        type: 'address',
        address: i[0]
      })
      extendedResult.push(' #' + i[1])
    })

    extendedResult.push('for')
    extendedResult.push({
      type: 'token',
      ...paymentToken
    })

    return [extendedResult]
  },
  [SudoSwapRouter.getSighash('robustSwapETHForSpecificNFTs')]: (txn, network, {extended = false}) => {
    const {swapList} = SudoSwapRouter.parseTransaction(txn).args

    const maxCost = swapList.reduce((prev, cur) => prev.add(cur.maxCost), BigNumber.from(0))
    const price = maxCost.toString()
    const paymentToken = nativeToken(network, price, true)

    const vaults = swapList.map(sl => {
      return {
        address: sl.swapInfo.pair,
        ids: sl.swapInfo.nftIds
      }
    })

    if (!extended) {
      return [`Buy NFT from vault ${vaults.map(v => v.address + ' id ' + v.ids.join(',')).join(', ')} for ${paymentToken.amount} ETH on SudoSwap`]
    }

    let extendedResult = [
      'Buy NFT',
      'from vault'
    ]

    vaults.forEach(v => {
      extendedResult.push({
        type: 'address',
        address: v.address
      })
      extendedResult.push('id ' + v.ids.join(','))
    })

    return [extendedResult]
  },
  [SudoSwapRouter.getSighash('swapNFTsForToken')]: (txn, network, {extended = false}) => {
    const {swapList, minOutput} = SudoSwapRouter.parseTransaction(txn).args

    const vaults = swapList.map(sl => ({
        address: sl.pair,
        ids: sl.nftIds
      })
    )

    const paymentToken = nativeToken(network, minOutput, true)

    if (!extended) {
      return [`Sell NFT to vault ${vaults.map(v => v.address + ' id ' + v.ids.join(',')).join(', ')} for ${paymentToken.amount} ETH on SudoSwap`]
    }

    let extendedResult = [
      'Sell NFT',
      'to vault'
    ]

    vaults.forEach(v => {
      extendedResult.push({
        type: 'address',
        address: v.address
      })
      extendedResult.push('id ' + v.ids.join(','))
    })

    extendedResult.push('for')
    extendedResult.push({
      type: 'token',
      ...paymentToken
    })

    return [extendedResult]
  },
  [SudoSwapRouter.getSighash('swapERC20ForAnyNFTs')]: (txn, network, {extended = false}) => {
    const {swapList, inputAmount} = SudoSwapRouter.parseTransaction(txn).args

    const totalNumItems = swapList.reduce((prev, cur) => prev.add(cur.numItems), BigNumber.from(0))

    const pairs = swapList.map(sl => sl.pair)

    const paymentToken = token('unknown', inputAmount, true)

    if (!extended) return [`Buy ${totalNumItems} NFT from vaults ${pairs.join(',')} for ${paymentToken.amount} units of tokens`]

    let extendedResult = [
      `Buy any ${totalNumItems} NFT`,
      'from vaults',
    ]

    pairs.forEach(p => extendedResult.push(p))

    extendedResult.push('for')

    extendedResult.push({
      type: 'token',
      ...paymentToken
    })

    return [extendedResult]

  },

}

export default SudoSwapMapping
