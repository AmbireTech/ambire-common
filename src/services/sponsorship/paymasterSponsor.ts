// NOTE: THIS ISN'T CURRENTLY USED ANYWHERE
// BUT KEEPING THE CODE HERE AS IT'S GOING TO BE IN A FUTURE PR

import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { Network } from '../../interfaces/network'
import { UserOperation } from '../../libs/userOperation/types'
import { getCleanUserOp } from '../../libs/userOperation/userOperation'
import { getRpcProvider } from '../provider'

export function getPaymasterStubData(url: string, network: Network, userOp: UserOperation) {
  const provider = getRpcProvider([url], network.chainId)
  return provider.send('pm_getPaymasterStubData', [
    getCleanUserOp(userOp)[0],
    ERC_4337_ENTRYPOINT,
    Number(network.chainId)
  ])
}

export function getPaymasterData(url: string, network: Network, userOp: UserOperation) {
  const provider = getRpcProvider([url], network.chainId)
  return provider.send('pm_getPaymasterData', [
    getCleanUserOp(userOp)[0],
    ERC_4337_ENTRYPOINT,
    Number(network.chainId)
  ])
}
