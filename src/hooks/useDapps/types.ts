import { AmbireDappManifest } from '../../services/dappCatalog/types'
import { UseStorageType } from '../useStorage'

export type UseDappsProps = {
  useStorage: UseStorageType
  fetch: any
}

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
  search?: string
  onSearchChange: (value: string | null) => void
  categories: Array<Category>
  categoryFilter: Category
  isDappInCatalog: (dappUrl: string) => boolean
  loadDappFromUrl: (dappUrl: string) => boolean
}
