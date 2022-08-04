import { useState, useCallback, useMemo, useEffect } from 'react'
import url from 'url'
import { getWalletDappCatalog } from '../../services/dappCatalog'
import { UseDappsProps, UseDappsReturnType, DappManifestData, Category } from './types'

const CATEGORIES: Array<Category> = [
  {
    name: 'all',
    filter: (f: any) => f
  },
  {
    name: 'integrated',
    filter: (f: any) => f.connectionType === 'gnosis'
  },
  {
    name: 'walletconnect',
    filter: (f: any) => f.connectionType === 'walletconnect'
  },
  {
    name: 'custom',
    filter: (f: any) => !!f.custom
  },
  {
    name: 'favorites',
    filter: (f: any, faves: object) => Object.keys(faves).indexOf(f.url) !== -1
  }
]

const withCategory = (dapp: DappManifestData) => ({
  ...dapp,
  category: dapp.connectionType === 'gnosis' ? 'integrated' : dapp.connectionType
})

export default function useDapps({ useStorage }: UseDappsProps): UseDappsReturnType {
  const categories = useMemo(() => CATEGORIES, [])
  const [defaultCatalog, setDefaultCatalog] = useState([])
  const [isDappMode, setIsDappMode] = useStorage<boolean>({ key: 'isDappMode' })
  const [sideBarOpen, setSideBarOpen] = useState(false)
  const [currentDappData, setCurrentDappData] = useStorage<DappManifestData | null>({
    key: 'currentDappData'
  })
  const [customDapps, updateCustomDapps] = useStorage<Array<DappManifestData>>({
    key: 'customDapps',
    defaultValue: []
  })

  const [search, setSearch] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<Category>(categories[0])
  const [favorites, setFavorites] = useStorage<{ [key: string]: boolean }>({
    key: 'dappCatalog-faves',
    defaultValue: {}
  })

  const catalog: Array<DappManifestData> = useMemo(
    () => [...defaultCatalog, ...customDapps].map(withCategory),
    [customDapps, defaultCatalog]
  )

  const [filteredCatalog, setFilteredItems] = useState(catalog)

  useEffect(() => {
    async function getCatalog() {
      const walletCatalog = await getWalletDappCatalog()
      setDefaultCatalog(walletCatalog)
    }

    getCatalog()
  }, [])

  const toggleDappMode = useCallback(() => {
    setIsDappMode(!isDappMode)
  }, [isDappMode, setIsDappMode])

  const toggleSideBarOpen = useCallback(() => {
    setSideBarOpen(!sideBarOpen)
  }, [sideBarOpen])

  const loadCurrentDappData = useCallback(
    (data: DappManifestData | null) => {
      setCurrentDappData(data)
      setIsDappMode(!!data)
    },
    [setCurrentDappData, setIsDappMode]
  )

  const addCustomDapp = useCallback(
    (dapp: DappManifestData) => {
      const exists = customDapps.find((x) => x.id === dapp.id)
      if (!exists) {
        updateCustomDapps([...customDapps, { ...dapp, custom: true }])
      }
    },
    [customDapps, updateCustomDapps]
  )

  const removeCustomDapp = useCallback(
    (dapp: DappManifestData) => {
      const index = customDapps.findIndex((x) => x.id === dapp.id)
      if (index >= 0) {
        const updated = [...customDapps]
        updated.splice(index, 1)
        updateCustomDapps(updated)
      }
    },
    [customDapps, updateCustomDapps]
  )

  const isDappInCatalog = (dappUrl: string) => {
    const dappHost = url.parse(dappUrl).host

    const isInCatalog = catalog.some(({ url: cDappUrl }) => url.parse(cDappUrl).host === dappHost)
    return isInCatalog
  }

  const toggleFavorite = useCallback(
    (dapp: DappManifestData) => {
      const updated = { ...favorites }
      if (updated[dapp.url]) {
        delete updated[dapp.url]
      } else {
        updated[dapp.url] = true
      }

      setFavorites(updated)
    },
    [favorites, setFavorites]
  )

  const onCategorySelect = useCallback((category: Category) => {
    setCategoryFilter(category)
  }, [])

  const onSearchChange = useCallback((val: string | null) => {
    setSearch(val)
  }, [])

  // refresh list from filters
  useEffect(() => {
    setFilteredItems(
      catalog.filter((item: any) => {
        let match = true
        if (categoryFilter) {
          match = categoryFilter.filter(item, favorites)
        }
        if (search && match) {
          match = item.name.toLowerCase().includes(search?.toLowerCase())
        }
        return match
      })
    )
  }, [catalog, search, categoryFilter, favorites])

  return {
    isDappMode,
    sideBarOpen,
    currentDappData,
    toggleDappMode,
    toggleSideBarOpen,
    loadCurrentDappData,
    addCustomDapp,
    removeCustomDapp,
    catalog,
    favorites,
    toggleFavorite,
    filteredCatalog,
    onCategorySelect,
    search,
    onSearchChange,
    categories,
    categoryFilter,
    isDappInCatalog
  }
}
