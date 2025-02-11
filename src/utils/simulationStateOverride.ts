import { toBeHex } from 'ethers'

import AmbireAccount from '../../contracts/compiled/AmbireAccount.json'
import { EOA_SIMULATION_NONCE } from '../consts/deployless'
import { privSlot } from '../libs/proxyDeploy/deploy'

/**
 *
 * @param accountAddr account address
 * @returns the state override object required for transaction simulation and estimation
 */
export function getEoaSimulationStateOverride(accountAddr: string) {
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
