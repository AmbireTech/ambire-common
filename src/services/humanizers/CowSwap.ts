/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-unused-vars */
// TODO: add types
// @ts-nocheck

import { Interface } from 'ethers/lib/utils'

const onBehalfText = (onBehalf, txnFrom) =>
  onBehalf.toLowerCase() !== txnFrom.toLowerCase() ? ` on behalf of ${onBehalf}` : ''

const CowSwap = (humanizerInfo) => {
  const iface = new Interface(humanizerInfo.abis.CowSwapSettlement)

  return {
    [iface.getSighash('setPreSignature')]: (txn, network, { extended }) => {
      const [orderUid, _signed] = iface.parseTransaction(txn).args
      if (extended)
        return [
          [
            'Execute CowSwap order',
            {
              type: 'link',
              link: `https://explorer.cow.fi/orders/${orderUid}?tab=overview`,
              text: 'more info here'
            }
          ]
        ]
      return [`CowSwap order ${orderUid}`]
    }
  }
}
export default CowSwap
