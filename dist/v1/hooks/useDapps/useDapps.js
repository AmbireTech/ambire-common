"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = useDapps;
const tslib_1 = require("tslib");
const react_1 = require("react");
const url_1 = tslib_1.__importDefault(require("url"));
const dappCatalog_1 = require("../../services/dappCatalog");
const CATEGORIES = [
    {
        name: 'all',
        filter: (f) => f
    },
    {
        name: 'integrated',
        filter: (f) => f.connectionType === 'gnosis'
    },
    {
        name: 'walletconnect',
        filter: (f) => f.connectionType === 'walletconnect'
    },
    {
        name: 'custom',
        filter: (f) => !!f.custom
    },
    {
        name: 'favorites',
        filter: (f, faves) => Object.keys(faves).indexOf(f.url) !== -1
    }
];
const withCategory = (dapp) => ({
    ...dapp,
    category: dapp.connectionType === 'gnosis' ? 'integrated' : dapp.connectionType
});
function useDapps({ useStorage, fetch, applicationType }) {
    const categories = (0, react_1.useMemo)(() => CATEGORIES, []);
    const [defaultCatalog, setDefaultCatalog] = (0, react_1.useState)([]);
    const [isDappMode, setIsDappMode] = useStorage({ key: 'isDappMode' });
    const [sideBarOpen, setSideBarOpen] = (0, react_1.useState)(false);
    const [currentDappData, setCurrentDappData] = useStorage({
        key: 'currentDappData'
    });
    const [customDapps, updateCustomDapps] = useStorage({
        key: 'customDapps',
        defaultValue: []
    });
    const [search, setSearch] = (0, react_1.useState)('');
    const [categoryFilter, setCategoryFilter] = (0, react_1.useState)(categories[0]);
    const [favorites, setFavorites] = useStorage({
        key: 'dappCatalog-faves',
        defaultValue: {}
    });
    const catalog = (0, react_1.useMemo)(() => [...defaultCatalog, ...customDapps].map(withCategory), [customDapps, defaultCatalog]);
    const [filteredCatalog, setFilteredItems] = (0, react_1.useState)(catalog);
    (0, react_1.useEffect)(() => {
        async function getCatalog() {
            const walletCatalog = await (0, dappCatalog_1.getWalletDappCatalog)(fetch);
            const catalogDapp = walletCatalog.filter((el) => el.applicationType.includes(applicationType)) || [];
            setDefaultCatalog(catalogDapp);
        }
        getCatalog();
    }, [fetch, applicationType]);
    const toggleDappMode = (0, react_1.useCallback)(() => {
        setIsDappMode(!isDappMode);
    }, [isDappMode, setIsDappMode]);
    const toggleSideBarOpen = (0, react_1.useCallback)(() => {
        setSideBarOpen(!sideBarOpen);
    }, [sideBarOpen]);
    const loadCurrentDappData = (0, react_1.useCallback)((data) => {
        setCurrentDappData(data);
        setIsDappMode(!!data);
    }, [setCurrentDappData, setIsDappMode]);
    const addCustomDapp = (0, react_1.useCallback)((dapp) => {
        const exists = customDapps.find((x) => x.id === dapp.id);
        if (!exists) {
            updateCustomDapps([...customDapps, { ...dapp, custom: true }]);
        }
    }, [customDapps, updateCustomDapps]);
    const removeCustomDapp = (0, react_1.useCallback)((dapp) => {
        const index = customDapps.findIndex((x) => x.id === dapp.id);
        if (index >= 0) {
            const updated = [...customDapps];
            updated.splice(index, 1);
            updateCustomDapps(updated);
        }
    }, [customDapps, updateCustomDapps]);
    const getDappFromCatalog = (0, react_1.useCallback)((dappUrl) => {
        const dappHost = url_1.default.parse(dappUrl).host;
        const dapp = catalog.find(({ url: cDappUrl }) => url_1.default.parse(cDappUrl).host === dappHost);
        return dapp;
    }, [catalog]);
    const isDappInCatalog = (0, react_1.useCallback)((dappUrl) => {
        return !!getDappFromCatalog(dappUrl);
    }, [getDappFromCatalog]);
    const loadDappFromUrl = (0, react_1.useCallback)((dappUrl) => {
        const dapp = getDappFromCatalog(dappUrl);
        if (dapp) {
            loadCurrentDappData(dapp);
            return true;
        }
        return false;
    }, [getDappFromCatalog, loadCurrentDappData]);
    const toggleFavorite = (0, react_1.useCallback)((dapp) => {
        const updated = { ...favorites };
        if (updated[dapp.url]) {
            delete updated[dapp.url];
        }
        else {
            updated[dapp.url] = true;
        }
        setFavorites(updated);
    }, [favorites, setFavorites]);
    const onCategorySelect = (0, react_1.useCallback)((category) => {
        setCategoryFilter(category);
    }, []);
    const onSearchChange = (0, react_1.useCallback)((val) => {
        setSearch(val || '');
    }, []);
    // refresh list from filters
    (0, react_1.useEffect)(() => {
        setFilteredItems([...catalog]
            .sort((a, b) => Number(!!b.featured) - Number(!!a.featured))
            .filter((item) => {
            let match = true;
            if (categoryFilter) {
                match = categoryFilter.filter(item, favorites);
            }
            if (search && match) {
                const matchedName = item.name.toLowerCase().includes(search?.toLowerCase());
                const matchedDescription = item.description
                    ?.toLowerCase()
                    .includes(search?.toLowerCase());
                match = matchedName || matchedDescription;
            }
            return match;
        }));
    }, [catalog, search, categoryFilter, favorites]);
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
        isDappInCatalog,
        loadDappFromUrl
    };
}
//# sourceMappingURL=useDapps.js.map