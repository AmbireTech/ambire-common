// TODO: add types
// @ts-nocheck

import { constants } from 'ethers'
import { Interface } from 'ethers/lib/utils'

import { HumanizerInfoType } from '../../hooks/useConstants'
import { getName, token } from '../humanReadableTransactions'

const ERC20Mapping = (humanizerInfo: HumanizerInfoType) => {
  const iface = new Interface(humanizerInfo.abis.ERC20)

  return {
    [iface.getSighash('approve')]: (txn, network, { extended = false }) => {
      const [approvedAddress, amount] = iface.parseTransaction(txn).args
      const name = getName(humanizerInfo, approvedAddress, network)
      const tokenName = getName(humanizerInfo, txn.to, network)
      if (amount.eq(0))
        return !extended
          ? [`Revoke approval for ${name} to use ${tokenName}`]
          : [
              [
                'Revoke',
                'approval for',
                {
                  type: 'address',
                  address: approvedAddress,
                  name
                },
                'to use',
                {
                  type: 'token',
                  ...token(humanizerInfo, txn.to, amount, true)
                }
              ]
            ]

      if (extended)
        return [
          [
            'Approve',
            {
              type: 'address',
              address: approvedAddress,
              name
            },
            `to use${amount.eq(constants.MaxUint256) ? ' your' : ''}`,
            {
              type: 'token',
              ...token(humanizerInfo, txn.to, amount, true)
            }
          ]
        ]

      if (amount.eq(constants.MaxUint256)) return [`Approve ${name} to use your ${tokenName}`]
      return [`Approve ${name} to use ${token(humanizerInfo, txn.to, amount)}`]
    },
    [iface.getSighash('transfer')]: (txn, network, { extended }) => {
      const [to, amount] = iface.parseTransaction(txn).args
      const name = getName(humanizerInfo, to, network)

      if (extended)
        return [
          [
            'Send',
            {
              type: 'token',
              ...token(humanizerInfo, txn.to, amount, true)
            },
            'to',
            {
              type: 'address',
              address: to,
              name
            }
          ]
        ]

      return [
        `Send ${token(humanizerInfo, txn.to, amount)} to ${to === name ? to : `${name} (${to})`}`
      ]
    }
  }
  /*
  // HACK: since this conflicts with ERC721 in terms of sigHash, but ERC721 is more likely to use this function from a user perspective, do not define this one
  [iface.getSighash('transferFrom')]: (txn, network) => {
    const [ from, to, amount ] = iface.parseTransaction(txn).args
    return [`Send ${token(humanizerInfo, txn.to, amount)} from ${getName(humanizerInfo, from, network)} to ${getName(humanizerInfo, to, network)}`]
  }, */
}
export default ERC20Mapping
