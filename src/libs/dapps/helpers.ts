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
    // Synthetix acquired Kwenta
    if (curr.url.includes('kwenta.io')) return acc
    // Open Sea Pro is no longer on e separate domain
    if (curr.url.includes('pro.opensea.io')) return acc
    // ParaSwap rebranded to Velora
    if (curr.url.includes('app.paraswap.io')) return acc
    // snapshot.org became snapshot.box
    if (curr.url.includes('snapshot.org')) return acc
    // play.decentraland.org redirects to decentraland.org
    if (curr.url.includes('play.decentraland.org')) return acc
    // bridge.arbitrum.io was moved to portal.arbitrum.io
    if (curr.url.includes('bridge.arbitrum.io')) return acc
    // curve.fi was moved to curve.finance
    if (curr.url.includes('curve.fi')) return acc
    // app.ether.fi was moved to ether.fi
    if (curr.url.includes('app.ether.fi')) return acc

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
