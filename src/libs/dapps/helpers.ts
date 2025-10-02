import { Dapp } from '../../interfaces/dapp'

const getDappIdFromUrl = (url?: string): string => {
  if (!url) return 'internal'

  try {
    const { hostname } = new URL(url)
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return url
  }
}

const dappIdsToBeRemoved = new Set([
  'legends.ambire.com', // Remove legends from the list as it was replaced with rewards.ambire.com
  'yearn.finance', // Remove the legacy Yarn Finance URL from the list
  'getpass.civic.com', // Civic Pass got shut down
  'mean.finance', // Mean Finance became Balmy, but Balmy got shut down
  'polygon.lido.fi', // Lido Polygon staking was sunset on June 16th 2025
  'kwenta.io', // Synthetix acquired Kwenta
  'pro.opensea.io', // Open Sea Pro is no longer on e separate domain
  'app.paraswap.io', // ParaSwap rebranded to Velora
  'snapshot.org', // snapshot.org became snapshot.box
  'play.decentraland.org', // play.decentraland.org redirects to decentraland.org
  'bridge.arbitrum.io', // bridge.arbitrum.io was moved to portal.arbitrum.io
  'curve.fi', // curve.fi was moved to curve.finance
  'app.ether.fi' // app.ether.fi was moved to ether.fi
])

/**
 * A temporary function used to patch apps stored in storage. As both predefined and custom apps
 * are stored in the same place and we don't have a mechanism to differentiate between them, we need to
 * remove the predefined ones from the storage.
 */
const patchStorageApps = (storageDapps: Dapp[]) => {
  return storageDapps.reduce((acc: Dapp[], curr: Dapp): Dapp[] => {
    const currAppId = getDappIdFromUrl(curr.url)
    if (dappIdsToBeRemoved.has(currAppId)) return acc

    return [...acc, curr]
  }, [])
}

export { patchStorageApps, getDappIdFromUrl }
