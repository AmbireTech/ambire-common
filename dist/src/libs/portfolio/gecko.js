"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geckoRequestBatcher = exports.geckoResponseIdentifier = void 0;
const tslib_1 = require("tslib");
const dotenv_1 = tslib_1.__importDefault(require("dotenv"));
const coingecko_1 = require("../../consts/coingecko");
const pagination_1 = require("./pagination");
dotenv_1.default.config();
// max tokens per request; we seem to have faster results when it's lower
const BATCH_LIMIT = 40;
function geckoResponseIdentifier(tokenAddr, network) {
    return (0, coingecko_1.geckoIdMapper)(tokenAddr, network) || tokenAddr.toLowerCase();
}
exports.geckoResponseIdentifier = geckoResponseIdentifier;
function geckoRequestBatcher(queue) {
    const segments = {};
    // eslint-disable-next-line no-restricted-syntax
    for (const queueItem of queue) {
        const geckoId = (0, coingecko_1.geckoIdMapper)(queueItem.data.address, queueItem.data.network);
        // If we can't determine the Gecko platform ID, we shouldn't make a request to price (cena.ambire.com)
        // since it would return nothing.
        // This can happen when adding a custom network that doesn't have a CoinGecko platform ID.
        // eslint-disable-next-line no-continue
        if (!geckoId && !queueItem.data.network.platformId)
            continue;
        let segmentId = queueItem.data.baseCurrency;
        if (geckoId)
            segmentId += ':natives';
        else
            segmentId += `:${queueItem.data.network.id}`;
        if (!segments[segmentId])
            segments[segmentId] = [];
        segments[segmentId].push(queueItem);
    }
    // deduplicating is OK because we use a key-based mapping (responseIdentifier) to map the responses
    // @TODO deduplication should happen BEFORE the pagination but without dropping items from queueSegment
    const pages = Object.entries(segments)
        .map(([key, queueSegment]) => (0, pagination_1.paginate)(queueSegment, BATCH_LIMIT).map((page) => ({ key, queueSegment: page })))
        .flat(1);
    const dedup = (x) => x.filter((y, i) => x.indexOf(y) === i);
    return pages.map(({ key, queueSegment }) => {
        // This is OK because we're segmented by baseCurrency
        const baseCurrency = queueSegment[0].data.baseCurrency;
        const geckoPlatform = queueSegment[0].data.network.platformId;
        const mainApiUrl = 'https://cena.ambire.com';
        let url;
        if (key.endsWith('natives'))
            url = `${mainApiUrl}/api/v3/simple/price?ids=${dedup(queueSegment.map((x) => (0, coingecko_1.geckoIdMapper)(x.data.address, x.data.network))).join('%2C')}&vs_currencies=${baseCurrency}`;
        else
            url = `${mainApiUrl}/api/v3/simple/token_price/${geckoPlatform}?contract_addresses=${dedup(queueSegment.map((x) => x.data.address)).join('%2C')}&vs_currencies=${baseCurrency}`;
        return { url, queueSegment };
    });
}
exports.geckoRequestBatcher = geckoRequestBatcher;
//# sourceMappingURL=gecko.js.map