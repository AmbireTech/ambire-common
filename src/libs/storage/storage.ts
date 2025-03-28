import { networks as predefinedNetworks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { KeystoreSeed, StoredKey } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { CashbackStatus, LegacyCashbackStatus } from '../../interfaces/selectedAccount'
import { getFeaturesByNetworkProperties, relayerAdditionalNetworks } from '../networks/networks'
import { LegacyTokenPreference } from '../portfolio/customToken'

export const getShouldMigrateKeystoreSeedsWithoutHdPath = (
  keystoreSeeds: string[] | KeystoreSeed[]
) =>
  // @ts-ignore TS complains, but we know that keystoreSeeds is either an array of strings or an array of objects
  !!keystoreSeeds?.length && keystoreSeeds.every((seed) => typeof seed === 'string')

export const getShouldMigrateKeyMetaNullToKeyMetaCreatedAt = (keystoreKeys: StoredKey[]) =>
  keystoreKeys.some((key) => {
    const internalKeyWithoutMeta = key.type === 'internal' && !key.meta
    const externalKeyWithoutCreatedAt = key.type !== 'internal' && !('createdAt' in key.meta)

    return internalKeyWithoutMeta || externalKeyWithoutCreatedAt
  })

export const needsCashbackStatusMigration = (
  cashbackStatusByAccount: Record<Account['addr'], CashbackStatus | LegacyCashbackStatus>
) => {
  return Object.values(cashbackStatusByAccount).some(
    (value) => typeof value === 'object' && value !== null && 'cashbackWasZeroAt' in value
  )
}

export const migrateHiddenTokens = (tokenPreferences: LegacyTokenPreference[]) => {
  return tokenPreferences
    .filter(({ isHidden }) => isHidden)
    .map(({ address, networkId, isHidden }: any) => ({
      address,
      networkId,
      isHidden
    }))
}

export const migrateCustomTokens = (tokenPreferences: LegacyTokenPreference[]) => {
  return tokenPreferences
    .filter(({ standard }) => !!standard)
    .map(({ address, standard, networkId }: any) => ({
      address,
      standard,
      networkId
    }))
}

export async function migrateNetworkPreferencesToNetworks(networkPreferences: {
  [key: string]: Partial<Network>
}) {
  const predefinedNetworkIds = predefinedNetworks.map((n) => (n as any).id)
  const customNetworkIds = Object.keys(networkPreferences).filter(
    (k) => !predefinedNetworkIds.includes(k)
  )

  const networksToStore: { [key: string]: Network } = {}

  predefinedNetworks.forEach((n) => {
    networksToStore[(n as any).id] = n
  })
  customNetworkIds.forEach((networkId: string) => {
    const preference = networkPreferences[networkId]
    const networkInfo = {
      chainId: preference.chainId!,
      isSAEnabled: preference.isSAEnabled ?? false,
      isOptimistic: preference.isOptimistic ?? false,
      rpcNoStateOverride: preference.rpcNoStateOverride ?? true,
      erc4337: preference.erc4337 ?? {
        enabled: false,
        hasPaymaster: false,
        hasBundlerSupport: false
      },
      areContractsDeployed: preference.areContractsDeployed ?? false,
      feeOptions: { is1559: (preference as any).is1559 ?? false },
      platformId: preference.platformId ?? '',
      nativeAssetId: preference.nativeAssetId ?? '',
      flagged: preference.flagged ?? false,
      hasSingleton: preference.hasSingleton ?? false
    }
    delete (preference as any).is1559
    networksToStore[networkId] = {
      id: networkId,
      ...preference,
      ...networkInfo,
      features: getFeaturesByNetworkProperties(networkInfo, undefined),
      hasRelayer: !!relayerAdditionalNetworks.find((net) => net.chainId === preference.chainId!),
      predefined: false
    } as Network
  })

  return networksToStore
}
