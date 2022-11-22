import { Interface } from 'ethers/lib/utils'

import { NetworkType } from '../../constants/networks'
import { HumanizerInfoType } from '../../hooks/useConstants'
import { nativeToken, token } from '../humanReadableTransactions'

const OneInchMapping = (humanizerInfo: HumanizerInfoType) => {
  // @ts-ignore: this type mismatch is a consistent issue with all
  // humanizers, not just this one. Temporary ignore it.
  // FIXME: handle this potential issue for all humanizers
  const iface = new Interface(humanizerInfo.abis.Swappin)

  return {
    [iface.getSighash('swap')]: (txn: any, network: NetworkType, { extended = false }) => {
      const { desc } = iface.parseTransaction(txn).args
      const paymentSrcToken =
        Number(desc.srcToken) === 0
          ? nativeToken(network, desc.amount, extended)
          : token(humanizerInfo, desc.srcToken, parseFloat(desc.amount), extended)
      const paymentToken =
        Number(desc.dstToken) === 0
          ? nativeToken(network, desc.minReturnAmount, extended)
          : token(humanizerInfo, desc.dstToken, parseFloat(desc.minReturnAmount), extended)

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

export default OneInchMapping
