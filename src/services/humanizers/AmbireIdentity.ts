// TODO: add types
// @ts-nocheck

import { Interface } from 'ethers/lib/utils'

import accountPresets from '../../constants/accountPresets'
import privilegesOptions from '../../constants/privilegesOptions'
import { HumanizerInfoType } from '../../hooks/useConstants'
import { getName } from '../humanReadableTransactions'

const iface = new Interface(require('adex-protocol-eth/abi/Identity5.2'))

const IdentityMapping = (humanizerInfo: HumanizerInfoType) => ({
  [iface.getSighash('setAddrPrivilege')]: (txn, network) => {
    const [addr, privLevel] = iface.parseTransaction(txn).args
    const name = getName(humanizerInfo, addr, network)
    const isQuickAccManager = addr.toLowerCase() === accountPresets.quickAccManager.toLowerCase()
    if (privLevel === privilegesOptions.false) {
      if (isQuickAccManager) return ['Revoke email/password access']
      return [`Revoke access for signer ${name}`]
    }
    if (privLevel === privilegesOptions.true) {
      if (isQuickAccManager) return ['INVALID PROCEDURE - DO NOT SIGN']
      return [`Authorize signer ${name}`]
    }
    if (isQuickAccManager) return ['Add a new email/password signer']
    return [`Set special authorization for ${name}`]
  }
})

export default IdentityMapping
