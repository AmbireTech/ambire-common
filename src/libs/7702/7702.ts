import { EIP_7702_AMBIRE_ACCOUNT, EIP_7702_GRID_PLUS, EIP_7702_METAMASK } from '../../consts/deploy'
import { EIP7702Auth } from '../../consts/7702'
import { Hex } from '../../interfaces/hex'
import { Network } from '../../interfaces/network'

export function getContractImplementation(
  chainId: bigint,
  accountKeys: {
    type: 'internal' | 'lattice' | 'trezor' | 'onekey' | 'ledger' | 'qr' | 'nfc' | 'pq1'
  }[]
): Hex {
  if (accountKeys.find((key) => key.type === 'lattice')) {
    return EIP_7702_GRID_PLUS
  }

  return EIP_7702_AMBIRE_ACCOUNT
}

/**
 * The contract that validates a userOp sent by a 7702 EOA, which dictates the signature
 * format the userOp needs. When the userOp carries a 7702 authorization, the EOA gets
 * re-delegated to the authorized contract before validation, so that contract wins over
 * the one the EOA currently points to (e.g. MetaMask's). An EOA that isn't delegated yet
 * and has no authorization falls back to the contract it would be delegated to.
 */
export function getUserOpDelegator({
  eip7702Auth,
  delegatedContract,
  chainId,
  accountKeys
}: {
  eip7702Auth?: EIP7702Auth
  delegatedContract: Hex | null
  chainId: bigint
  accountKeys: Parameters<typeof getContractImplementation>[1]
}): Hex {
  return (
    eip7702Auth?.address ?? delegatedContract ?? getContractImplementation(chainId, accountKeys)
  )
}

export function has7702(net: Network) {
  return net.has7702
}

export function getDelegatorName(contract: Hex) {
  switch (contract.toLowerCase()) {
    case EIP_7702_AMBIRE_ACCOUNT.toLowerCase():
      return 'Ambire'

    case EIP_7702_GRID_PLUS.toLowerCase():
      return 'Ambire'

    case EIP_7702_METAMASK.toLowerCase():
      return 'Metamask'

    default:
      return ''
  }
}
