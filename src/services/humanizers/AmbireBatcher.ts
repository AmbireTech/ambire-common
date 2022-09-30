// TODO: add types and fix (dependency cycle warning)
// @ts-nocheck

import { Interface } from 'ethers/lib/utils'

import { HumanizerInfoType } from '../../hooks/useConstants'
// eslint-disable-next-line import/no-useless-path-segments
import humanizers from './'

const AmbireBatcher = (humanizerInfo: HumanizerInfoType) => {
  const iface = new Interface(humanizerInfo.abis.Batcher)

  return {
    [iface.getSighash('batchCall')]: (txn, network, opts) => {
      const { txns } = iface.parseTransaction(txn).args
      const { to, value, data, from } = txns[txns.length - 1]
      const sigHash = data.slice(0, 10)
      const humanizer = humanizers(humanizerInfo)[sigHash]
      return humanizer({ to, value, data, from }, network, opts)
    }
  }
}
export default AmbireBatcher
