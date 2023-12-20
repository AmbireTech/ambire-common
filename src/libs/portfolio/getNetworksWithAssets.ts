import { AccountId } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { RPCProviders } from '../../interfaces/settings'
import { AccountState } from './interfaces'

const getAccountNetworksWithAssets = (
  accountId: AccountId,
  accountState: AccountState,
  storageStateByAccount: {
    [accountId: string]: NetworkDescriptor['id'][]
  },
  providers: RPCProviders
): NetworkDescriptor['id'][] => {
  let networksWithAssets: NetworkDescriptor['id'][] = []

  Object.keys(accountState).forEach((networkId) => {
    const isRPCDown = !providers[networkId].isWorking
    const result = accountState[networkId]?.result

    // RPC is down or an error occurred
    if (!result || isRPCDown) {
      // The user wasn't previously in storage, because the account is new.
      // Since the RPC is down we can't know if the user has assets on this network.
      // We assume the presence of assets, avoiding unnecessary concern during the RPC outage.
      if (!storageStateByAccount[accountId]) networksWithAssets.push(networkId)

      // The user has assets on this network and the RPC is down
      if (
        storageStateByAccount[accountId]?.includes(networkId) &&
        !networksWithAssets.includes(networkId)
      )
        networksWithAssets.push(networkId)

      return
    }

    // RPC is up and we have a result
    const nonZeroTokens = result.tokens.filter(({ amount }) => Number(amount) !== 0)
    const hasCollectibles = result.collections.length > 0

    // The user has assets on this network
    if (nonZeroTokens.length || hasCollectibles) {
      if (networksWithAssets.includes(networkId)) return

      networksWithAssets.push(networkId)
      return
    }

    // The user doesn't have assets on this network
    networksWithAssets = networksWithAssets.filter((id) => id !== networkId)
  })

  return networksWithAssets
}

export default getAccountNetworksWithAssets
