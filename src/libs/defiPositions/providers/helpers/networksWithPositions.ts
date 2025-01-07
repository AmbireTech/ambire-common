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

  Object.keys(accountState).forEach((networkId) => {
    if (!providers[networkId]) return

    const isRPCDown = !providers[networkId].isWorking
    const { positionsByProvider, error, providerErrors } = accountState[networkId]

    // RPC is down or an error occurred
    if (error || isRPCDown || providerErrors?.length) return

    networksWithPositions[networkId] = positionsByProvider.reduce(
      (networksWithPositionsByProviders, provider) => {
        if (networksWithPositionsByProviders.includes(provider.providerName))
          return networksWithPositionsByProviders

        networksWithPositionsByProviders.push(provider.providerName)

        return networksWithPositionsByProviders
      },
      networksWithPositions[networkId] || []
    )
  })

  return networksWithPositions
}

export default getAccountNetworksWithPositions
