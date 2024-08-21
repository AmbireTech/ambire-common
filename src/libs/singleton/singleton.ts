import {
  getAddress,
  getCreate2Address,
  Interface,
  JsonRpcProvider,
  keccak256,
  Provider
} from 'ethers'

import { SINGLETON } from '../../consts/deploy'
import { Call } from '../accountOp/types'

// Special exception for the singleton deployer:
// Estimation on various networks depends entirely on the RPC
// implementation of eth_estimateGas. On ethereum, the RPC tends
// to return ~6kk for our deploy contracts call, which is great as
// the txn will pass (it needs about 4kk).
//
// On polygon though, it returns ~600k, meaning the txn will fail with
// out of gas without any warnings to the user. That's why we need
// to manually up the gasUsed to at least 4500000n,
//
// Then come networks with wild gas estimations above 10m (Arbitrum, Mantle)
// Because of the blob updates, networks fees on this networks have lowered
// dramatically. But no RPC can estimate correctly how much gas is need to
// correctly deploy on the network. That's why we do a multiplication by 5
// and hope for the best.
//
// The backside to this is that txns to the singleton can overestimate.
// Overestimation is now so bad, though. If the real gas is lower, the funds
// will not be taken from the user. Underestimation is worse as txn fails.
export function getGasUsed(gasUsed: bigint): bigint {
  if (gasUsed < 4500000n) return 4500000n

  if (gasUsed > 10000000n) return gasUsed * 5n

  return gasUsed
}

// if there's a call to the singleton deployer, check if the
// contract is not already deployed
export async function isContractDeployed(
  provider: JsonRpcProvider | Provider,
  call: Call
): Promise<boolean> {
  if (!call.to || getAddress(call.to) !== SINGLETON) return false

  try {
    const singletonABI = [
      {
        inputs: [
          { internalType: 'bytes', name: '_initCode', type: 'bytes' },
          { internalType: 'bytes32', name: '_salt', type: 'bytes32' }
        ],
        name: 'deploy',
        outputs: [{ internalType: 'address payable', name: 'createdContract', type: 'address' }],
        stateMutability: 'nonpayable',
        type: 'function'
      }
    ]
    const singletonInterface = new Interface(singletonABI)
    const [bytecode, salt] = singletonInterface.decodeFunctionData('deploy', call.data)
    const addr = getCreate2Address(SINGLETON, salt, keccak256(bytecode))
    const code = await provider.getCode(addr)
    return code !== '0x'
  } catch (e: any) {
    // if the code above didn't work, just report the error and move on
    // as it's not the end of the world
    //
    // this code is more for an UX improvement
    console.log(e)
  }

  return false
}
