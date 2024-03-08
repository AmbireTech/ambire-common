import { fetchCaught } from '../fetch'
import { AmbireDappManifest } from './types'

export const DEFAULT_DAPP_CATALOG_URL =
  'https://dappcatalog.ambire.com/ambire-wallet-dapp-catalog.json'

export async function getWalletDappCatalog(
  fetch: any,
  catalogUrl?: string
): Promise<Array<AmbireDappManifest>> {
  const catalog = await fetchCaught<any>(fetch, catalogUrl || DEFAULT_DAPP_CATALOG_URL)

  return catalog.body || []
}

export * from './types'
export * from './dappCatalogUtils'
