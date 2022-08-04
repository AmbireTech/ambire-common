import {
  getGnosisDefaultList,
  getWalletGnosisDefaultList,
  getWalletWalletconnectDefaultList
} from './dappCatalogUtils'
import { AmbireDappManifest } from './types'

export async function getWalletDappCatalog(): Promise<Array<AmbireDappManifest>> {
  const dappCatalog = getWalletGnosisDefaultList()
    .concat(getGnosisDefaultList())
    .concat(getWalletWalletconnectDefaultList())

  // NOTE: make it async just in case for future separate service/call with validated dapps
  return Promise.resolve(dappCatalog)
}

export * from './types'
export * from './dappCatalogUtils'