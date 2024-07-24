// @ts-nocheck

import { Interface } from 'ethers/lib/utils'
import { HumanizerInfoType } from 'hooks/useConstants'

// eslint-disable-next-line import/no-cycle
import { token } from '../humanReadableTransactions'

const parseZeroAddressIfNeeded = (address: string) => {
  return address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    ? '0x0000000000000000000000000000000000000000'
    : address
}

const getSwap = (
  humanizerInfo: HumanizerInfoType,
  srcToken: string,
  fromAmount: string,
  destToken: string,
  toAmount: bigint,
  extended: bigint
) =>
  extended
    ? [
        'Swap',
        {
          type: 'token',
          ...token(humanizerInfo, parseZeroAddressIfNeeded(srcToken), fromAmount, true)
        },
        'for',
        {
          type: 'token',
          ...token(humanizerInfo, parseZeroAddressIfNeeded(destToken), toAmount, true)
        }
      ]
    : `Swap ${token(humanizerInfo, srcToken, fromAmount)} for ${token(
        humanizerInfo,
        destToken,
        toAmount
      )}`

const ParaswapMapping = (humanizerInfo: HumanizerInfoType) => {
  const iface = new Interface(humanizerInfo.abis.ParaswapRouter)
  return {
    [iface.getSighash('swapExactAmountIn')]: (txn, network, opts = {} as any) => {
      const {
        swapData: { srcToken, destToken, fromAmount, toAmount }
      } = iface.parseTransaction(txn).args
      return [getSwap(humanizerInfo, srcToken, fromAmount, destToken, toAmount, opts?.extended)]
    },
    [iface.getSighash('swapExactAmountInOnCurveV1')]: (txn, network, opts = {} as any) => {
      const {
        curveV1Data: { srcToken, destToken, fromAmount, toAmount }
      } = iface.parseTransaction(txn).args
      return [getSwap(humanizerInfo, srcToken, fromAmount, destToken, toAmount, opts?.extended)]
    },
    [iface.getSighash('swapExactAmountInOnCurveV2')]: (txn, network, opts = {} as any) => {
      const {
        curveV2Data: srcToken,
        destToken,
        fromAmount,
        toAmount
      } = iface.parseTransaction(txn).args
      return [getSwap(humanizerInfo, srcToken, fromAmount, destToken, toAmount, opts?.extended)]
    },
    [iface.getSighash('swapExactAmountInOnUniswapV2')]: (txn, network, opts = {} as any) => {
      const {
        uniData: { srcToken, destToken, fromAmount, toAmount }
      } = iface.parseTransaction(txn).args
      return [getSwap(humanizerInfo, srcToken, fromAmount, destToken, toAmount, opts?.extended)]
    },
    [iface.getSighash('swapExactAmountInOnUniswapV3')]: (txn, network, opts = {} as any) => {
      const {
        uniData: { srcToken, destToken, fromAmount, toAmount }
      } = iface.parseTransaction(txn).args
      return [getSwap(humanizerInfo, srcToken, fromAmount, destToken, toAmount, opts?.extended)]
    },
    [iface.getSighash('swapExactAmountOut')]: (txn, network, opts = {} as any) => {
      const {
        swapData: { srcToken, destToken, fromAmount, toAmount }
      } = iface.parseTransaction(txn).args
      return [getSwap(humanizerInfo, srcToken, fromAmount, destToken, toAmount, opts?.extended)]
    },
    [iface.getSighash('swapExactAmountOutOnUniswapV2')]: (txn, network, opts = {} as any) => {
      const {
        uniData: { srcToken, destToken, fromAmount, toAmount }
      } = iface.parseTransaction(txn).args
      return [getSwap(humanizerInfo, srcToken, fromAmount, destToken, toAmount, opts?.extended)]
    },
    [iface.getSighash('swapExactAmountOutOnUniswapV3')]: (txn, network, opts = {} as any) => {
      const {
        uniData: { srcToken, destToken, fromAmount, toAmount }
      } = iface.parseTransaction(txn).args
      return [getSwap(humanizerInfo, srcToken, fromAmount, destToken, toAmount, opts?.extended)]
    }
  }
}
export default ParaswapMapping
