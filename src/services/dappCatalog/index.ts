import { AmbireDappManifest } from './types'
import {
  getWalletGnosisDefaultList,
  getGnosisDefaultList,
  getWalletWalletconnectDefaultList
} from './dappCatalogUtils'

export async function getWalletDappCatalog(): Promise<Array<AmbireDappManifest>> {
  const dappCatalog = getWalletGnosisDefaultList()
    .concat(getGnosisDefaultList())
    .concat(getWalletWalletconnectDefaultList())

    //NOTE: make ir async just in case for future separate service/call with validated dapps
  return Promise.resolve(dappCatalog)
}

export * from './types'
export * from './dappCatalogUtils'