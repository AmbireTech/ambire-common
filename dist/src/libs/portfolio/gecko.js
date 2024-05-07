"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.geckoRequestBatcher = exports.geckoResponseIdentifier = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const coingecko_1 = require("../../consts/coingecko");
const pagination_1 = require("./pagination");
dotenv_1.default.config();
// max tokens per request; we seem to have faster results when it's lower
const BATCH_LIMIT = 40;
function geckoResponseIdentifier(tokenAddr, networkId) {
    return (0, coingecko_1.geckoIdMapper)(tokenAddr, networkId) || tokenAddr.toLowerCase();
}
exports.geckoResponseIdentifier = geckoResponseIdentifier;
function geckoRequestBatcher(queue) {
    const segments = {};
    for (const queueItem of queue) {
        let segmentId = queueItem.data.baseCurrency;
        const geckoId = (0, coingecko_1.geckoIdMapper)(queueItem.data.address, queueItem.data.networkId);
        if (geckoId)
            segmentId += ':natives';
        else
            segmentId += `:${queueItem.data.networkId}`;
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
        const geckoPlatform = (0, coingecko_1.geckoNetworkIdMapper)(queueSegment[0].data.networkId);
        const cgKey = process.env.COINGECKO_PRO_API_KEY;
        const mainApiUrl = cgKey ? 'https://pro-api.coingecko.com' : 'https://api.coingecko.com';
        const apiKeyString = cgKey ? `&x_cg_pro_api_key=${cgKey}` : '';
        let url;
        if (key.endsWith('natives'))
            url = `${mainApiUrl}/api/v3/simple/price?ids=${dedup(queueSegment.map((x) => (0, coingecko_1.geckoIdMapper)(x.data.address, x.data.networkId))).join('%2C')}&vs_currencies=${baseCurrency}${apiKeyString}`;
        else
            url = `${mainApiUrl}/api/v3/simple/token_price/${geckoPlatform}?contract_addresses=${dedup(queueSegment.map((x) => x.data.address)).join('%2C')}&vs_currencies=${baseCurrency}${apiKeyString}`;
        return { url, queueSegment };
    });
}
exports.geckoRequestBatcher = geckoRequestBatcher;
//# sourceMappingURL=gecko.js.map