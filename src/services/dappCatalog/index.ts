import { AmbireDappManifest } from './types'
import {
  getWalletGnosisDefaultList,
  getGnosisDefaultList,
  getWalletWalletconnectDefaultList
} from './dappCatalogUtils'

function getWalletDappCatalog(): AmbireDappManifest[] {
  const dappCatalog = getWalletGnosisDefaultList()
    .concat(getGnosisDefaultList())
    .concat(getWalletWalletconnectDefaultList())

  return dappCatalog
}

export * from './types'
export * from './dappCatalogUtils'

export default getWalletDappCatalog
