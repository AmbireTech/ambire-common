// TODO: add types
// @ts-nocheck

import { abis } from '../../constants/humanizerInfo.json'
import { Interface } from 'ethers/lib/utils'
import { nativeToken, token } from '../humanReadableTransactions'

const swappin = new Interface(abis.Swappin)

const SwappinMapping = {
  [swappin.getSighash('swap')]: (txn, network, { extended = false }) => {
    const { desc } = swappin.parseTransaction(txn).args
    const paymentSrcToken = Number(desc.srcToken) === 0 ? nativeToken(network, desc.amount, true) : token(desc.srcToken, parseFloat(desc.amount), true)
    const paymentToken = Number(desc.dstToken) === 0 ? nativeToken(network, desc.minReturnAmount, true) : token(desc.dstToken, parseFloat(desc.minReturnAmount), true)

    return [
        [
            'Swap',
            {
                type: 'token',
                ...paymentSrcToken
            },
            'for at least',
            {
                type: 'token',
                ...paymentToken
            },
            'on Swappin'
        ]
    ]
  },
}

export default SwappinMapping
