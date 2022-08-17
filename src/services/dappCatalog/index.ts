import { fetchGet } from '../fetch'
import { AmbireDappManifest } from './types'

export const DEFAULT_DAPP_CATALOG_URL =
  'https://dappcatalog.ambire.com/ambire-wallet-dapp-catalog.json'

export async function getWalletDappCatalog(
  fetch: any,
  catalogUrl?: string
): Promise<Array<AmbireDappManifest>> {
  const catalog = await fetchGet(fetch, catalogUrl || DEFAULT_DAPP_CATALOG_URL)

  return catalog
}

export * from './types'
export * from './dappCatalogUtils'
