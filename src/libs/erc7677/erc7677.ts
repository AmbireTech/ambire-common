import { toBeHex } from 'ethers'

import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Network } from '../../interfaces/network'
import { getRpcProvider } from '../../services/provider'
import { UserOperation } from '../userOperation/types'
import { getCleanUserOp } from '../userOperation/userOperation'
import {
  PaymasterCapabilities,
  PaymasterData,
  PaymasterEstimationData,
  PaymasterService
} from './types'

export function getPaymasterService(
  chainId: `0x${string}`,
  capabilities?: { paymasterService?: PaymasterCapabilities }
): PaymasterService | undefined {
  if (!capabilities || !capabilities.paymasterService || !capabilities.paymasterService[chainId])
    return undefined

  const paymasterService = capabilities.paymasterService[chainId]
  paymasterService.id = new Date().getTime()
  return paymasterService
}

export function getPaymasterStubData(
  service: PaymasterService,
  userOp: UserOperation,
  network: Network
): Promise<PaymasterEstimationData> {
  const provider = getRpcProvider([service.url], network.chainId)
  return provider.send('pm_getPaymasterStubData', [
    getCleanUserOp(userOp)[0],
    ERC_4337_ENTRYPOINT,
    toBeHex(network.chainId.toString()),
    service.context
  ])
}

export async function getPaymasterData(
  service: PaymasterService,
  userOp: UserOperation,
  network: Network
): Promise<PaymasterData> {
  const provider = getRpcProvider([service.url], network.chainId)
  return provider.send('pm_getPaymasterData', [
    getCleanUserOp(userOp)[0],
    ERC_4337_ENTRYPOINT,
    toBeHex(network.chainId.toString()),
    service.context
  ])
}
