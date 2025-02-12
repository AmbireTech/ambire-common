"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefiPositionsController = void 0;
const tslib_1 = require("tslib");
const helpers_1 = require("../../libs/defiPositions/helpers");
const providers_1 = require("../../libs/defiPositions/providers");
const networksWithPositions_1 = tslib_1.__importDefault(require("../../libs/defiPositions/providers/helpers/networksWithPositions"));
const types_1 = require("../../libs/defiPositions/types");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
class DefiPositionsController extends eventEmitter_1.default {
    #selectedAccount;
    #providers;
    #networks;
    #fetch;
    #storage;
    #minUpdateInterval = 60 * 1000; // 1 minute
    #state = {};
    #networksWithPositionsByAccounts = {};
    constructor({ fetch, storage, selectedAccount, providers, networks }) {
        super();
        this.#fetch = fetch;
        this.#storage = storage;
        this.#selectedAccount = selectedAccount;
        this.#providers = providers;
        this.#networks = networks;
    }
    #setProviderError(accountAddr, networkId, providerName, errorMessage) {
        if (!this.#state[accountAddr][networkId].providerErrors) {
            this.#state[accountAddr][networkId].providerErrors = [];
        }
        this.#state[accountAddr][networkId].providerErrors.push({
            providerName,
            error: errorMessage
        });
    }
    #getCanSkipUpdate(accountAddr, networkId, maxDataAgeMs = this.#minUpdateInterval) {
        const networkState = this.#state[accountAddr][networkId];
        if (networkState.error || networkState.providerErrors?.length)
            return false;
        const isWithinMinUpdateInterval = networkState.updatedAt && Date.now() - networkState.updatedAt < maxDataAgeMs;
        return isWithinMinUpdateInterval || networkState.isLoading;
    }
    async #updateNetworksWithPositions(accountId, accountState) {
        const storageStateByAccount = await this.#storage.get('networksWithPositionsByAccounts', {});
        this.#networksWithPositionsByAccounts[accountId] = (0, networksWithPositions_1.default)(accountId, accountState, storageStateByAccount, this.#providers.providers);
        this.emitUpdate();
        await this.#storage.set('networksWithPositionsByAccounts', this.#networksWithPositionsByAccounts);
    }
    async updatePositions(opts) {
        const { networkId, maxDataAgeMs } = opts || {};
        if (!this.#selectedAccount.account)
            return;
        const selectedAccountAddr = this.#selectedAccount.account.addr;
        const networksToUpdate = networkId
            ? this.#networks.networks.filter((n) => n.id === networkId)
            : this.#networks.networks;
        if (!this.#state[selectedAccountAddr]) {
            this.#state[selectedAccountAddr] = {};
        }
        await Promise.all(networksToUpdate.map(async (n) => {
            if (!this.#state[selectedAccountAddr][n.id]) {
                this.#state[selectedAccountAddr][n.id] = {
                    isLoading: false,
                    positionsByProvider: [],
                    updatedAt: undefined
                };
            }
            if (this.#getCanSkipUpdate(selectedAccountAddr, n.id, maxDataAgeMs)) {
                // Emit an update so that the current account data getter is updated
                this.emitUpdate();
                return;
            }
            this.#state[selectedAccountAddr][n.id].isLoading = true;
            this.emitUpdate();
            const networkState = this.#state[selectedAccountAddr][n.id];
            // Reset provider errors before updating
            networkState.providerErrors = [];
            networkState.error = undefined;
            try {
                const previousPositions = networkState.positionsByProvider;
                const [aavePositions, uniV3Positions] = await Promise.all([
                    (0, providers_1.getAAVEPositions)(selectedAccountAddr, this.#providers.providers[n.id], n).catch((e) => {
                        console.error('getAAVEPositions error:', e);
                        this.#setProviderError(selectedAccountAddr, n.id, 'AAVE v3', e?.message || 'Unknown error');
                        // We should consider changing the structure of positions in a way
                        // that this isn't needed. This is done so if there is an error,
                        // old data can still be displayed
                        return previousPositions?.find((p) => p.providerName === 'AAVE v3') || null;
                    }),
                    (0, providers_1.getUniV3Positions)(selectedAccountAddr, this.#providers.providers[n.id], n).catch((e) => {
                        console.error('getUniV3Positions error:', e);
                        this.#setProviderError(selectedAccountAddr, n.id, 'Uniswap V3', e?.message || 'Unknown error');
                        // We should consider changing the structure of positions in a way
                        // that this isn't needed. This is done so if there is an error,
                        // old data can still be displayed
                        return previousPositions?.find((p) => p.providerName === 'Uniswap V3') || null;
                    })
                ]);
                const hasErrors = !!this.#state[selectedAccountAddr][n.id].providerErrors?.length;
                this.#state[selectedAccountAddr][n.id] = {
                    ...networkState,
                    isLoading: false,
                    positionsByProvider: [aavePositions, uniV3Positions].filter(Boolean),
                    updatedAt: hasErrors ? networkState.updatedAt : Date.now()
                };
                await this.#setAssetPrices(selectedAccountAddr, n.id).catch((e) => {
                    console.error('#setAssetPrices error:', e);
                    this.#state[selectedAccountAddr][n.id].error = types_1.DeFiPositionsError.AssetPriceError;
                });
            }
            catch (e) {
                const prevPositionsByProvider = networkState.positionsByProvider;
                this.#state[selectedAccountAddr][n.id] = {
                    isLoading: false,
                    positionsByProvider: prevPositionsByProvider || [],
                    error: types_1.DeFiPositionsError.CriticalError
                };
                console.error(`updatePositions error on ${n.id}`, e);
            }
            finally {
                this.emitUpdate();
            }
        }));
        await this.#updateNetworksWithPositions(selectedAccountAddr, this.#state[selectedAccountAddr]);
    }
    async #setAssetPrices(accountAddr, networkId) {
        const platformId = this.#networks.networks.find((n) => n.id === networkId)?.platformId;
        // If we can't determine the Gecko platform ID, we shouldn't make a request to price (cena.ambire.com)
        // since it would return nothing.
        // This can happen when adding a custom network that doesn't have a CoinGecko platform ID.
        if (!platformId)
            throw new Error('Missing `platformId`');
        const dedup = (x) => x.filter((y, i) => x.indexOf(y) === i);
        const networkState = this.#state[accountAddr][networkId];
        const addresses = [];
        networkState.positionsByProvider.forEach((providerPos) => {
            providerPos.positions.forEach((p) => {
                p.assets.forEach((a) => {
                    addresses.push(a.address);
                });
            });
        });
        const cenaUrl = `https://cena.ambire.com/api/v3/simple/token_price/${platformId}?contract_addresses=${dedup(addresses).join('%2C')}&vs_currencies=usd`;
        const resp = await this.#fetch(cenaUrl);
        const body = await resp.json();
        if (resp.status !== 200)
            throw body;
        // eslint-disable-next-line no-prototype-builtins
        if (body.hasOwnProperty('message'))
            throw body;
        // eslint-disable-next-line no-prototype-builtins
        if (body.hasOwnProperty('error'))
            throw body;
        const positionsByProviderWithPrices = this.#state[accountAddr][networkId].positionsByProvider.map((positionsByProvider) => {
            if (positionsByProvider.providerName.toLowerCase().includes('aave'))
                return positionsByProvider;
            const updatedPositions = positionsByProvider.positions.map((position) => {
                let positionInUSD = position.additionalData.positionInUSD || 0;
                const updatedAssets = position.assets.map((asset) => {
                    const priceData = body[asset.address.toLowerCase()];
                    if (!priceData)
                        return asset;
                    const priceIn = Object.entries(priceData).map(([currency, price]) => ({
                        baseCurrency: currency,
                        price: price
                    }));
                    const value = (0, helpers_1.getAssetValue)(asset.amount, asset.decimals, priceIn);
                    positionInUSD += value;
                    return {
                        ...asset,
                        value,
                        priceIn
                    };
                });
                return {
                    ...position,
                    assets: updatedAssets,
                    additionalData: { ...position.additionalData, positionInUSD }
                };
            });
            let positionInUSD = positionsByProvider.positionInUSD;
            // Already set in the corresponding lib
            if (!positionInUSD) {
                positionInUSD = updatedPositions.reduce((prevPositionValue, position) => {
                    return prevPositionValue + (position.additionalData.positionInUSD || 0);
                }, 0);
            }
            return { ...positionsByProvider, positions: updatedPositions, positionInUSD };
        });
        this.#state[accountAddr][networkId].positionsByProvider = positionsByProviderWithPrices;
    }
    removeNetworkData(networkId) {
        Object.keys(this.#state).forEach((accountId) => {
            delete this.#state[accountId][networkId];
        });
        this.emitUpdate();
    }
    getDefiPositionsState(accountAddr) {
        return this.#state[accountAddr] || {};
    }
    getNetworksWithPositions(accountAddr) {
        return this.#networksWithPositionsByAccounts[accountAddr] || [];
    }
    removeAccountData(accountAddr) {
        delete this.#state[accountAddr];
        delete this.#networksWithPositionsByAccounts[accountAddr];
        this.#storage.set('networksWithPositionsByAccounts', this.#networksWithPositionsByAccounts);
        this.emitUpdate();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON()
        };
    }
}
exports.DefiPositionsController = DefiPositionsController;
//# sourceMappingURL=defiPositions.js.map