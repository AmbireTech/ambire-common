// TODO: add types
// @ts-nocheck

import {Interface} from 'ethers/lib/utils'
import {abis} from '../../constants/humanizerInfo.json'
import {BigNumber} from 'ethers'

import {nativeToken, token} from '../humanReadableTransactions'
import {HumanizerInfoType} from '../../hooks/useConstants'

const SudoSwapMapping = (humanizerInfo: HumanizerInfoType) => {

  const SudoSwapFactory = new Interface(humanizerInfo.abis.SudoSwapFactory)
  const SudoSwapRouter = new Interface(humanizerInfo.abis.SudoSwapRouter)

  return {
    [SudoSwapFactory.getSighash('createPairETH')]
  :
    (txn, network, {extended = false}) => {
      const {_nft, _spotPrice, _poolType, _initialNFTIDs} = SudoSwapFactory.parseTransaction(txn).args

      if (_poolType === 0) { // making collection offer

        const price = txn.value

        // the amount of nfts in the offer
        const nftPieces = price / _spotPrice

        const paymentToken = nativeToken(network, price, true)

        return !extended
          ? [`${_poolType} Make an offer of ${nftPieces} NFTs for ${_nft} for ${paymentToken.amount} ETH`]
          : [[
            'Make an offer',
            `of ${nftPieces} NFTs for`,
            {
              type: 'address',
              address: _nft
            },
            'for',
            {
              type: 'token',
              ...paymentToken
            }
          ]
          ]
      } else if (_poolType === 1) { // listing nft

        const paymentToken = nativeToken(network, _spotPrice, true)
        return !extended
          ? [`List NFT ${_nft} #${_initialNFTIDs.join(',')} for ${paymentToken.amount} ETH`]
          : [
            [
              'List NFT',
              {
                type: 'address',
                address: _nft,
              },
              `#${_initialNFTIDs.join(',')}`,
              'for',
              {
                type: 'token',
                ...paymentToken
              },
            ]
          ]
      }
    },
      [SudoSwapFactory.getSighash('createPairERC20')]
  :
    (txn, network, {extended = false}) => {
      const {params} = SudoSwapFactory.parseTransaction(txn).args
      const paymentToken = token(params.token, params.spotPrice, true)

      return !extended
        ? [`Make an offer for ${params.nft} #${params.initialNFTIDs.join(',')} for ${paymentToken.amount} ${paymentToken.symbol || 'Unknown token'}`]
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
          ]
        ]
    },
      [SudoSwapFactory.getSighash('depositNFTs')]
  :
    (txn, network, {extended = false}) => {
      const {_nft, ids} = SudoSwapFactory.parseTransaction(txn).args
      const nfts = ids.map(id => ({address: _nft, id}))
      return !extended
        ? [`Deposit NFT ${_nft} #${ids.join(',')}`]
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

      [SudoSwapRouter.getSighash('swapETHForSpecificNFTs')]
  :
    (txn, network, {extended = false}) => {
      const {swapList} = SudoSwapRouter.parseTransaction(txn).args
      const price = txn.value
      const paymentToken = nativeToken(network, price, true)

      if (!extended) return [`Buy NFT from vaults ${swapList.map(i => i[0] + ' #' + i[1]).join(',')} for ${paymentToken.amount} ETH`]

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
      [SudoSwapRouter.getSighash('robustSwapETHForSpecificNFTs')]
  :
    (txn, network, {extended = false}) => {
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
        return [`Buy NFT from vault ${vaults.map(v => v.address + ' #' + v.ids.join(',')).join(', ')} for ${paymentToken.amount} ETH`]
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
        extendedResult.push('#' + v.ids.join(','))
      })

      return [extendedResult]
    },
      [SudoSwapRouter.getSighash('swapNFTsForToken')]
  :
    (txn, network, {extended = false}) => {
      const {swapList, minOutput} = SudoSwapRouter.parseTransaction(txn).args

      const vaults = swapList.map(sl => ({
          address: sl.pair,
          ids: sl.nftIds
        })
      )

      const paymentToken = nativeToken(network, minOutput, true)

      if (!extended) {
        return [`Sell NFT to vault ${vaults.map(v => v.address + ' #' + v.ids.join(',')).join(', ')} for ${paymentToken.amount} ETH`]
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
        extendedResult.push('#' + v.ids.join(','))
      })

      extendedResult.push('for')
      extendedResult.push({
        type: 'token',
        ...paymentToken
      })

      return [extendedResult]
    },
      [SudoSwapRouter.getSighash('swapERC20ForAnyNFTs')]
  :
    (txn, network, {extended = false}) => {
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
}

export default SudoSwapMapping
