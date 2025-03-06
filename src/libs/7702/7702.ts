import { networks7702 } from '../../consts/7702'
import { EIP_7702_AMBIRE_ACCOUNT } from '../../consts/deploy'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'

export function getContractImplementation(chainId: bigint): Hex {
  if (networks7702[chainId.toString()]) return networks7702[chainId.toString()].implementation

  return EIP_7702_AMBIRE_ACCOUNT
}

export function has7702(net: Network) {
  return net.has7702 || !!networks7702[net.chainId.toString()]
}
