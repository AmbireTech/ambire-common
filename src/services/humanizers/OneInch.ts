// TODO: add types
// @ts-nocheck
import { Interface } from 'ethers/lib/utils'

import { NetworkType } from '../../constants/networks'
import { HumanizerInfoType } from '../../hooks/useConstants'
import { nativeToken, token } from '../humanReadableTransactions'

const parseZeroAddressIfNeeded = (address: string) => {
  return address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ? '0x0000000000000000000000000000000000000000'
    : address
}

const toExtended = (action: string, word: string, fromToken: any) => {
  return [
    [
      action,
      {
        type: 'token',
        ...fromToken
      },
      word
    ]
  ]
}

const OneInchMapping = (humanizerInfo: HumanizerInfoType) => {
  // @ts-ignore: this type mismatch is a consistent issue with all
  // humanizers, not just this one. Temporary ignore it.
  // FIXME: handle this potential issue for all humanizers
  const iface = new Interface(humanizerInfo.abis.Swappin)

  return {
    [iface.getSighash('swap')]: (txn: any, network: NetworkType, { extended = false }) => {
      const { desc } = iface.parseTransaction(txn).args
      const srcToken = parseZeroAddressIfNeeded(desc.srcToken)
      const dstToken = parseZeroAddressIfNeeded(desc.dstToken)
      const paymentSrcToken =
        Number(srcToken) === 0
          ? nativeToken(network, desc.amount, extended)
          : token(humanizerInfo, srcToken, desc.amount, extended)
      const paymentToken =
        Number(dstToken) === 0
          ? nativeToken(network, desc.minReturnAmount, extended)
          : token(humanizerInfo, dstToken, desc.minReturnAmount, extended)

      return !extended
        ? [`Swap ${paymentSrcToken} for at least ${paymentToken} on 1inch`]
        : [
            [
              'Swap',
              {
                type: 'token',
                // @ts-ignore: this type mismatch is a consistent issue with all
                // humanizers, not just this one. Temporary ignore it.
                // FIXME: handle this potential issue for all humanizers
                ...paymentSrcToken
              },
              'for at least',
              {
                type: 'token',
                // @ts-ignore: this type mismatch is a consistent issue with all
                // humanizers, not just this one. Temporary ignore it.
                // FIXME: handle this potential issue for all humanizers
                ...paymentToken
              },
              'on 1inch'
            ]
          ]
    }
  }
}

const SwappinMapping = (humanizerInfo: HumanizerInfoType) => {
  const SwappinInterface = new Interface(humanizerInfo.abis.SwappinOwn)

  return {
    [SwappinInterface.getSighash('payWithEth')]: (txn: any, network: NetworkType, opts: any) => {
      const { amountFrom } = SwappinInterface.parseTransaction(txn).args
      return !opts.extended
        ? [`Pay with ${nativeToken(network, amountFrom, opts.extended)} for a gift card`]
        : toExtended(
            'Swapping',
            'for a gift card on Swappin.gifts',
            nativeToken(network, amountFrom, opts.extended)
          )
    },
    [SwappinInterface.getSighash('payWithUsdToken')]: (
      txn: any,
      network: NetworkType,
      opts: any
    ) => {
      const { amount, token: destToken } = SwappinInterface.parseTransaction(txn).args
      return !opts.extended
        ? [`Pay with ${token(humanizerInfo, destToken, amount)} for a gift card`]
        : toExtended(
            'Swapping',
            'for a gift card on Swappin.gifts',
            token(humanizerInfo, destToken, amount, opts.extended)
          )
    },
    [SwappinInterface.getSighash('payWithAnyToken')]: (
      txn: any,
      network: NetworkType,
      opts: any
    ) => {
      const { amountFrom, tokenFrom } = SwappinInterface.parseTransaction(txn).args
      return !opts.extended
        ? [`Pay with ${token(humanizerInfo, tokenFrom, amountFrom, opts.extended)} for a gift card`]
        : toExtended(
            'Swapping',
            'for a gift card on Swappin.gifts',
            token(humanizerInfo, tokenFrom, amountFrom, opts.extended)
          )
    }
  }
}

const mapping = (humanizerInfo: HumanizerInfoType) => {
  return {
    ...OneInchMapping(humanizerInfo),
    ...SwappinMapping(humanizerInfo)
  }
}

export default mapping
