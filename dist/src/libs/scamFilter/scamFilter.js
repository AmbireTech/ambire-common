"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScamFilter = void 0;
const ethers_1 = require("ethers");
const coingecko_1 = require("../../consts/coingecko");
const fetch_1 = require("../../utils/fetch");
const pagination_1 = require("../portfolio/pagination");
const CENA_API_URL = 'https://cena.ambire.com';
const BATCH_LIMIT = 40;
const DEFAULT_TIMEOUT = 4500;
const BASE_CURRENCY = 'usd';
const dedup = (values) => values.filter((value, index) => values.indexOf(value) === index);
const hasPrice = (priceData) => typeof priceData?.[BASE_CURRENCY] === 'number' && priceData[BASE_CURRENCY] > 0;
class ScamFilter {
    #fetch;
    #network;
    #timeout;
    constructor({ fetch, network, timeout = DEFAULT_TIMEOUT }) {
        this.#fetch = fetch;
        this.#network = network;
        this.#timeout = timeout;
    }
    async #fetchCenaPriceResponse(url) {
        const response = await (0, fetch_1.fetchWithTimeout)(this.#fetch, url, {}, this.#timeout);
        const body = await response.json();
        if (response.status !== 200)
            throw body;
        if (Object.prototype.hasOwnProperty.call(body, 'message'))
            throw body;
        if (Object.prototype.hasOwnProperty.call(body, 'error'))
            throw body;
        return body;
    }
    async #getPricedContractAddresses(tokenAddresses) {
        if (!this.#network.platformId || !tokenAddresses.length)
            return new Set();
        const pricedAddresses = new Set();
        const pages = (0, pagination_1.paginate)(dedup(tokenAddresses), BATCH_LIMIT);
        await Promise.all(pages.map(async (page) => {
            const url = `${CENA_API_URL}/api/v3/simple/token_price/${this.#network.platformId}?contract_addresses=${page.join('%2C')}&vs_currencies=${BASE_CURRENCY}`;
            try {
                const body = await this.#fetchCenaPriceResponse(url);
                page.forEach((address) => {
                    if (hasPrice(body[address.toLowerCase()]))
                        pricedAddresses.add(address);
                });
            }
            catch {
                // If Cena cannot confirm a price exists, keep the token filtered out.
            }
        }));
        return pricedAddresses;
    }
    async #getPricedGeckoIds(geckoIds) {
        if (!geckoIds.length)
            return new Set();
        const pricedGeckoIds = new Set();
        const pages = (0, pagination_1.paginate)(dedup(geckoIds), BATCH_LIMIT);
        await Promise.all(pages.map(async (page) => {
            const url = `${CENA_API_URL}/api/v3/simple/price?ids=${page.join('%2C')}&vs_currencies=${BASE_CURRENCY}`;
            try {
                const body = await this.#fetchCenaPriceResponse(url);
                page.forEach((geckoId) => {
                    if (hasPrice(body[geckoId]))
                        pricedGeckoIds.add(geckoId);
                });
            }
            catch {
                // If Cena cannot confirm a price exists, keep the token filtered out.
            }
        }));
        return pricedGeckoIds;
    }
    async filterTokensWithoutAPrice(tokenAddresses) {
        const tokenPriceChecks = tokenAddresses.reduce((acc, originalAddress) => {
            try {
                const normalizedAddress = (0, ethers_1.getAddress)(originalAddress);
                acc.push({
                    originalAddress,
                    normalizedAddress,
                    geckoId: (0, coingecko_1.geckoIdMapper)(normalizedAddress, this.#network)
                });
            }
            catch {
                // Invalid addresses do not have a Cena price.
            }
            return acc;
        }, []);
        const geckoIds = tokenPriceChecks
            .map(({ geckoId }) => geckoId)
            .filter((geckoId) => !!geckoId);
        const contractAddresses = tokenPriceChecks
            .filter(({ geckoId }) => !geckoId)
            .map(({ normalizedAddress }) => normalizedAddress);
        const [pricedGeckoIds, pricedContractAddresses] = await Promise.all([
            this.#getPricedGeckoIds(geckoIds),
            this.#getPricedContractAddresses(contractAddresses)
        ]);
        return tokenPriceChecks
            .filter(({ geckoId, normalizedAddress }) => geckoId ? pricedGeckoIds.has(geckoId) : pricedContractAddresses.has(normalizedAddress))
            .map(({ originalAddress }) => originalAddress);
    }
}
exports.ScamFilter = ScamFilter;
//# sourceMappingURL=scamFilter.js.map