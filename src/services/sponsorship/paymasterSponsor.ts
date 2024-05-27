import { ERC_4337_ENTRYPOINT } from '../../consts/deploy'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { UserOperation } from '../../libs/userOperation/types'
import { getCleanUserOp } from '../../libs/userOperation/userOperation'
import { getRpcProvider } from '../provider'

export function getPaymasterStubData(
  url: string,
  network: NetworkDescriptor,
  userOp: UserOperation
) {
  const provider = getRpcProvider([url], network.chainId)
  return provider.send('pm_getPaymasterStubData', [
    getCleanUserOp(userOp)[0],
    ERC_4337_ENTRYPOINT,
    Number(network.chainId)
  ])
}
