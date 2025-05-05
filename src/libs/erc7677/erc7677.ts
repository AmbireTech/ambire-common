import { toBeHex, toQuantity } from 'ethers'

import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Network } from '../../interfaces/network'
import { getRpcProvider } from '../../services/provider'
import { BaseAccount } from '../account/BaseAccount'
import { UserOperation } from '../userOperation/types'
import { getCleanUserOp } from '../userOperation/userOperation'
import {
  PaymasterCapabilities,
  PaymasterData,
  PaymasterEstimationData,
  PaymasterService
} from './types'

export function getPaymasterService(
  chainId: bigint,
  capabilities?: { paymasterService?: PaymasterCapabilities }
): PaymasterService | undefined {
  if (!capabilities || !capabilities.paymasterService) return undefined

  // hex may come with a leading zero or not. Prepare for both
  const chainIds = Object.keys(capabilities.paymasterService)
  const chainIdHex = toBeHex(chainId).toLowerCase() as `0x${string}`
  const chainIdQuantity = toQuantity(chainId).toLowerCase() as `0x${string}`
  const foundChainId: any = chainIds.find(
    (id) => id.toLowerCase() === chainIdHex || id.toLowerCase() === chainIdQuantity
  )
  if (!foundChainId) return undefined

  const paymasterService = capabilities.paymasterService[foundChainId]
  paymasterService.id = new Date().getTime()
  return paymasterService
}

export function getAmbirePaymasterService(
  baseAcc: BaseAccount,
  relayerUrl: string
): PaymasterService | undefined {
  if (!baseAcc.isSponsorable()) return undefined

  return {
    url: `${relayerUrl}/v2/sponsorship`,
    id: new Date().getTime()
  }
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
