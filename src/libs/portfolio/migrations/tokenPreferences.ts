import { LegacyTokenPreference } from '../customToken'

const inferStorageVersion = (tokenPreferences: LegacyTokenPreference[]) => {
  if (tokenPreferences.some(({ symbol, decimals }) => !!symbol || !!decimals)) {
    return 1
  }

  return 2
}

const migrateHiddenTokens = (tokenPreferences: LegacyTokenPreference[]) => {
  return tokenPreferences
    .filter(({ isHidden }) => isHidden)
    .map(({ address, networkId, isHidden }) => ({
      address,
      networkId,
      isHidden
    }))
}

const migrateCustomTokens = (tokenPreferences: LegacyTokenPreference[]) => {
  return tokenPreferences.map(({ address, standard, networkId }) => ({
    address,
    standard,
    networkId
  }))
}

export { inferStorageVersion, migrateHiddenTokens, migrateCustomTokens }
