import { toBeHex } from 'ethers'

import AmbireAccount from '../../contracts/compiled/AmbireAccount.json'
import { EOA_SIMULATION_NONCE } from '../consts/deployless'
import { privSlot } from '../libs/proxyDeploy/deploy'

/**
 * Get the state override needed for accounts that are not Ambire smart accounts
 * like EOA, 7702 EOA that haven't become 7702, yet, or Safe accounts
 */
export function getNotAmbireStateOverride(accountAddr: string) {
  return {
    [accountAddr]: {
      code: AmbireAccount.binRuntime,
      stateDiff: {
        // if we use 0x00...01 we get a geth bug: "invalid argument 2: hex number with leading zero digits\" - on some RPC providers
        [privSlot(0, 'uint256', accountAddr, 'uint256')]:
          '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        // any number with leading zeros is not supported on some RPCs
        [toBeHex(1, 32)]: EOA_SIMULATION_NONCE
      }
    }
  }
}
