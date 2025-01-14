import { AccountId } from '../../interfaces/account'
import { NetworkId } from '../../interfaces/network'
import { RPCProviders } from '../../interfaces/provider'
import { AccountState } from './interfaces'

const hasAssetsOnNetwork = (
  storageState: { [networkId: string]: boolean } | NetworkId[],
  networkId: NetworkId
): boolean => {
  if (typeof storageState === 'object' && !Array.isArray(storageState)) {
    return !!storageState[networkId]
  }
  if (Array.isArray(storageState)) {
    return storageState.includes(networkId)
  }
  return false
}

const getAccountNetworksWithAssets = (
  accountId: AccountId,
  accountState: AccountState,
  storageStateByAccount: {
    [accountId: string]: { [networkId: NetworkId]: boolean } | NetworkId[]
  },
  providers: RPCProviders
): { [networkId: NetworkId]: boolean } => {
  const networksWithAssets: { [networkId: NetworkId]: boolean } = {}

  Object.keys(accountState).forEach((networkId) => {
    if (!providers[networkId]) return

    const isRPCDown = !providers[networkId].isWorking
    const result = accountState[networkId]?.result

    // !!! Important: Add the flag isWorking to rpc providers when writing tests if you
    // rely on networksWithAssets
    // RPC is down or an error occurred
    if (!result || isRPCDown) {
      // The account has assets on this network and the RPC is down
      if (hasAssetsOnNetwork(storageStateByAccount[accountId], networkId)) {
        networksWithAssets[networkId] = true
      } else {
        networksWithAssets[networkId] = false
      }
      return
    }

    // RPC is up and we have a result
    const nonZeroTokens = result.tokens.filter(({ amount }) => Number(amount) !== 0)
    const hasCollectibles = result.collections && result.collections.length > 0

    // The account has assets on this network
    if (nonZeroTokens.length || hasCollectibles) {
      networksWithAssets[networkId] = true
    } else {
      networksWithAssets[networkId] = false
    }
  })

  return networksWithAssets
}

export default getAccountNetworksWithAssets
