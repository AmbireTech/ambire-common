import { AccountId } from '../../../../interfaces/account'
import { RPCProviders } from '../../../../interfaces/provider'
import { AccountState, NetworksWithPositions, NetworksWithPositionsByAccounts } from '../../types'

const getAccountNetworksWithPositions = (
  accountId: AccountId,
  accountState: AccountState,
  oldNetworksWithPositionsByAccounts: NetworksWithPositionsByAccounts,
  providers: RPCProviders
): NetworksWithPositions => {
  const networksWithPositions: NetworksWithPositions = {
    ...oldNetworksWithPositionsByAccounts[accountId]
  }

  Object.keys(accountState).forEach((chainId) => {
    if (!providers[chainId]) return

    const isRPCDown = !providers[chainId].isWorking
    const { positionsByProvider, error, providerErrors } = accountState[chainId]

    // RPC is down or an error occurred
    if (error || isRPCDown || providerErrors?.length) return

    networksWithPositions[chainId] = positionsByProvider.reduce(
      (networksWithPositionsByProviders, provider) => {
        if (networksWithPositionsByProviders.includes(provider.providerName))
          return networksWithPositionsByProviders

        networksWithPositionsByProviders.push(provider.providerName)

        return networksWithPositionsByProviders
      },
      networksWithPositions[chainId] || []
    )
  })

  return networksWithPositions
}

export default getAccountNetworksWithPositions
