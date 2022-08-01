import { AmbireDappManifest } from '../../services/dappCatalog/types'
import { UseStorageType } from '../useStorage'

export type UseDappsProps = {
  useStorage: UseStorageType
}

export type DappType = 'integrated' | 'walletconnect' | 'custom'

// // TODO: extend gnosis manifest and add ambire wallet specific props
// export interface DappManifestData {
//     name: string,
//     title: string,
//     url: string,
//     logo: string,
//     description: string,
//     type: DappType,
//     networks: Array<string>,
// }

export type DappManifestData = AmbireDappManifest & { custom?: boolean }

export type DappCatalog = Array<DappManifestData>

export type Category = {
  name: string
  filter: (x: any, y?: any) => boolean
}

export type UseDappsReturnType = {
  isDappMode: boolean
  sideBarOpen: boolean
  currentDappData: DappManifestData | null
  toggleDappMode: () => void
  toggleSideBarOpen: () => void
  loadCurrentDappData: (data: DappManifestData | null) => void
  addCustomDapp: (dapp: DappManifestData) => void
  removeCustomDapp: (dapp: DappManifestData) => void
  favorites: { [key: string]: boolean }
  toggleFavorite: (dapp: DappManifestData) => void
  catalog: Array<DappManifestData>
  filteredCatalog: Array<DappManifestData>
  onCategorySelect: (category: Category) => void
  search: string | null
  onSearchChange: (value: string | null) => void
  categories: Array<Category>
  categoryFilter: Category
}
