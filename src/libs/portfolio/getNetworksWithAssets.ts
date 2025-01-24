import { AccountId } from '../../interfaces/account'
import { RPCProviders } from '../../interfaces/provider'
import { AccountAssetsState, AccountState } from './interfaces'

const getAccountNetworksWithAssets = (
  accountId: AccountId,
  accountState: AccountState,
  storageStateByAccount: {
    [accountId: string]: AccountAssetsState
  },
  providers: RPCProviders
): AccountAssetsState => {
  const networksWithAssets = { ...storageStateByAccount[accountId] }

  Object.keys(accountState).forEach((networkId) => {
    if (!providers[networkId]) return

    const isRPCDown = !providers[networkId].isWorking
    const result = accountState[networkId]?.result

    // RPC is down or an error occurred
    if (!result || isRPCDown) return

    // RPC is up and we have a result
    const nonZeroTokens = result.tokens.filter(({ amount }) => Number(amount) !== 0)
    const hasCollectibles = result.collections && result.collections.length > 0

    // The account has assets on this network
    networksWithAssets[networkId] = !!nonZeroTokens.length || !!hasCollectibles
  })

  return networksWithAssets
}

export default getAccountNetworksWithAssets
