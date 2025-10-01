import { Dapp } from '../../interfaces/dapp'

/**
 * A temporary function used to patch apps stored in storage. As both predefined and custom apps
 * are stored in the same place and we don't have a mechanism to differentiate between them, we need to
 * remove the predefined ones from the storage.
 */
const patchStorageApps = (storageDapps: Dapp[]) => {
  return storageDapps.reduce((acc: Dapp[], curr: Dapp): Dapp[] => {
    // Remove legends from the list as it was replaced with rewards.ambire.com
    if (curr.url.includes('legends.ambire.com')) return acc
    // Remove the legacy Yarn Finance URL from the list
    if (curr.url.includes('yearn.finance')) return acc
    // Civic Pass got shut down
    if (curr.url.includes('getpass.civic.com')) return acc
    // Mean Finance became Balmy, but Balmy got shut down
    if (curr.url.includes('mean.finance')) return acc
    // Lido Polygon staking was sunset on June 16th 2025
    if (curr.url.includes('polygon.lido.fi')) return acc

    return [...acc, curr]
  }, [])
}

const getDappIdFromUrl = (url?: string): string => {
  if (!url) return 'internal'

  try {
    const { hostname } = new URL(url)
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return url
  }
}

export { patchStorageApps, getDappIdFromUrl }
