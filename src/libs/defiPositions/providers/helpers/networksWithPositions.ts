import { AccountId } from '../../../../interfaces/account'
import { NetworkId } from '../../../../interfaces/network'
import { RPCProviders } from '../../../../interfaces/provider'
import { AccountState } from '../../types'

const getAccountNetworksWithPositions = (
  accountId: AccountId,
  accountState: AccountState,
  storageStateByAccount: {
    [accountId: string]: NetworkId[]
  },
  providers: RPCProviders
): NetworkId[] => {
  let networksWithPositions: NetworkId[] = []

  Object.keys(accountState).forEach((networkId) => {
    if (!providers[networkId]) return

    const isRPCDown = !providers[networkId].isWorking
    const { positionsByProvider, error } = accountState[networkId]

    // RPC is down or an error occurred
    if (error || isRPCDown) {
      if (!storageStateByAccount[accountId]) networksWithPositions.push(networkId)

      if (
        storageStateByAccount[accountId]?.includes(networkId) &&
        !networksWithPositions.includes(networkId)
      )
        networksWithPositions.push(networkId)

      return
    }

    // RPC is up and we have a result
    // The account has positions on this network
    if (positionsByProvider.length) {
      if (networksWithPositions.includes(networkId)) return

      networksWithPositions.push(networkId)
      return
    }

    // The account doesn't have positions on this network
    networksWithPositions = networksWithPositions.filter((id) => id !== networkId)
  })

  return networksWithPositions
}

export default getAccountNetworksWithPositions
