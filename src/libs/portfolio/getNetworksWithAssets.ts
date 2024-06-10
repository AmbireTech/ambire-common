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
    if (!providers[networkId]) return

    const isRPCDown = !providers[networkId].isWorking
    const result = accountState[networkId]?.result

    // !!! Important: Add the flag isWorking to rpc providers when writing tests if you
    // rely on networksWithAssets
    // RPC is down or an error occurred
    if (!result || isRPCDown) {
      // The account isn't in storage and was added after the RPC stopped working.
      // We assume the presence of assets, avoiding unnecessary concern during the RPC outage.
      if (!storageStateByAccount[accountId]) networksWithAssets.push(networkId)

      // The account has assets on this network and the RPC is down
      if (
        storageStateByAccount[accountId]?.includes(networkId) &&
        !networksWithAssets.includes(networkId)
      )
        networksWithAssets.push(networkId)

      return
    }

    // RPC is up and we have a result
    const nonZeroTokens = result.tokens.filter(({ amount }) => Number(amount) !== 0)
    const hasCollectibles = result.collections && result.collections.length > 0

    // The account has assets on this network
    if (nonZeroTokens.length || hasCollectibles) {
      if (networksWithAssets.includes(networkId)) return

      networksWithAssets.push(networkId)
      return
    }

    // The account doesn't have assets on this network
    networksWithAssets = networksWithAssets.filter((id) => id !== networkId)
  })

  return networksWithAssets
}

export default getAccountNetworksWithAssets
