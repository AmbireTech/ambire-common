import { dappIdsToBeRemoved } from '../../consts/dapps'
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
