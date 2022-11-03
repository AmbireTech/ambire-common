import { Interface } from 'ethers/lib/utils'

import { NetworkType } from '../../constants/networks'
import { HumanizerInfoType } from '../../hooks/useConstants'
import { nativeToken, token } from '../humanReadableTransactions'

const parseZeroAddressIfNeeded = (address: string) => {
  return address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ? '0x0000000000000000000000000000000000000000'
    : address
}

const SwappinMapping = (humanizerInfo: HumanizerInfoType) => {
  // @ts-ignore: this type mismatch is a consistent issue with all
  // humanizers, not just this one. Temporary ignore it.
  // FIXME: handle this potential issue for all humanizers
  const swappin = new Interface(humanizerInfo.abis.Swappin)

  return {
    [swappin.getSighash('swap')]: (txn: any, network: NetworkType, { extended = false }) => {
      const { desc } = swappin.parseTransaction(txn).args
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
        ? [`Swap ${paymentSrcToken} for at least ${paymentToken} on Swappin`]
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
              'on Swappin'
            ]
          ]
    }
  }
}

export default SwappinMapping
