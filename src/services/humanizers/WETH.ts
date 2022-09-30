// TODO: add types
// @ts-nocheck

import { Interface } from 'ethers/lib/utils'

import { HumanizerInfoType } from '../../hooks/useConstants'
import { nativeToken } from '../humanReadableTransactions'

const WETHMapping = (humanizerInfo: HumanizerInfoType) => {
  const iface = new Interface(humanizerInfo.abis.WETH)

  return {
    [iface.getSighash('deposit')]: (txn, network) => {
      const { value } = iface.parseTransaction(txn)
      return [`Wrap ${nativeToken(network, value)}`]
    },
    [iface.getSighash('withdraw')]: (txn, network) => {
      const [amount] = iface.parseTransaction(txn).args
      return [`Unwrap ${nativeToken(network, amount)}`]
    }
  }
}
export default WETHMapping
