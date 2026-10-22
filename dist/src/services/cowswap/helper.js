"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOutputValueInUsd = exports.computeOrderUid = exports.getCowSwapOrderUid = exports.getCowSwapOrderStruct = exports.buildAppData = exports.getProtocolFeeAmount = exports.normalizeBuyTokenAddress = exports.getWrappedNativeTokenAddress = exports.getApiNetwork = exports.normalizeCowSwapToken = exports.isCowSwapTokenListEntry = exports.ethFlowInterface = exports.settlementInterface = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const SwapAndBridgeProviderApiError_1 = tslib_1.__importDefault(require("../../classes/SwapAndBridgeProviderApiError"));
const addresses_1 = require("../../consts/addresses");
const constants_1 = require("./constants");
exports.settlementInterface = new ethers_1.Interface([
    'function setPreSignature(bytes orderUid, bool signed)'
]);
exports.ethFlowInterface = new ethers_1.Interface([
    'function createOrder((address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,bytes32 appData,uint256 feeAmount,uint32 validTo,bool partiallyFillable,int64 quoteId) order) payable returns (bytes32 orderHash)'
]);
const MAX_VALID_TO = 2 ** 32 - 1;
const orderTypes = {
    Order: [
        { name: 'sellToken', type: 'address' },
        { name: 'buyToken', type: 'address' },
        { name: 'receiver', type: 'address' },
        { name: 'sellAmount', type: 'uint256' },
        { name: 'buyAmount', type: 'uint256' },
        { name: 'validTo', type: 'uint32' },
        { name: 'appData', type: 'bytes32' },
        { name: 'feeAmount', type: 'uint256' },
        { name: 'kind', type: 'string' },
        { name: 'partiallyFillable', type: 'bool' },
        { name: 'sellTokenBalance', type: 'string' },
        { name: 'buyTokenBalance', type: 'string' }
    ]
};
const isCowSwapTokenListEntry = (value) => {
    if (!value || typeof value !== 'object')
        return false;
    if (!('address' in value) ||
        !('chainId' in value) ||
        !('decimals' in value) ||
        !('name' in value) ||
        !('symbol' in value))
        return false;
    return (typeof value.address === 'string' &&
        (0, ethers_1.isAddress)(value.address) &&
        typeof value.chainId === 'number' &&
        Number.isInteger(value.chainId) &&
        typeof value.decimals === 'number' &&
        Number.isInteger(value.decimals) &&
        value.decimals >= 0 &&
        value.decimals <= 255 &&
        typeof value.name === 'string' &&
        !!value.name &&
        typeof value.symbol === 'string' &&
        !!value.symbol &&
        (!('logoURI' in value) || value.logoURI === undefined || typeof value.logoURI === 'string'));
};
exports.isCowSwapTokenListEntry = isCowSwapTokenListEntry;
const normalizeCowSwapToken = (token) => ({
    address: (0, ethers_1.getAddress)(token.address),
    chainId: token.chainId,
    decimals: token.decimals,
    icon: token.logoURI || '',
    name: token.name,
    symbol: token.symbol
});
exports.normalizeCowSwapToken = normalizeCowSwapToken;
const getApiNetwork = (chainId) => constants_1.COWSWAP_SUPPORTED_CHAINS.find((chain) => chain.chainId === chainId)?.apiNetwork;
exports.getApiNetwork = getApiNetwork;
const getWrappedNativeTokenAddress = (chainId) => constants_1.COWSWAP_SUPPORTED_CHAINS.find((chain) => chain.chainId === chainId)?.wrappedNativeTokenAddress;
exports.getWrappedNativeTokenAddress = getWrappedNativeTokenAddress;
const normalizeBuyTokenAddress = (address) => address.toLowerCase() === ethers_1.ZeroAddress.toLowerCase()
    ? constants_1.COWSWAP_BUY_NATIVE_TOKEN_ADDRESS
    : (0, ethers_1.getAddress)(address);
exports.normalizeBuyTokenAddress = normalizeBuyTokenAddress;
const getProtocolFeeAmount = (buyAmount, protocolFeeBps) => {
    if (protocolFeeBps <= 0)
        return 0n;
    const precision = 100000n;
    const protocolFeeBpsWithPrecision = BigInt(Math.round(protocolFeeBps * Number(precision)));
    const denominator = 10000n * precision - protocolFeeBpsWithPrecision;
    if (denominator <= 0n) {
        throw new SwapAndBridgeProviderApiError_1.default('Unable to fetch the quote. CoW Swap returned an invalid fee.');
    }
    return (buyAmount * protocolFeeBpsWithPrecision) / denominator;
};
exports.getProtocolFeeAmount = getProtocolFeeAmount;
const buildAppData = ({ slippageBps, feeBps }) => {
    const appData = {
        appCode: constants_1.COWSWAP_APP_CODE,
        metadata: {
            orderClass: { orderClass: 'market' },
            ...(feeBps
                ? {
                    partnerFee: {
                        recipient: addresses_1.FEE_COLLECTOR,
                        volumeBps: feeBps
                    }
                }
                : {}),
            quote: { slippageBips: slippageBps }
        },
        version: constants_1.COWSWAP_APP_DATA_VERSION
    };
    const fullAppData = JSON.stringify(appData);
    return {
        fullAppData,
        appDataHash: (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)(fullAppData))
    };
};
exports.buildAppData = buildAppData;
/** Picks the fields of an order we submit to CoW Swap that its order ID commits to. */
const getCowSwapOrderStruct = (order) => ({
    sellToken: order.sellToken,
    buyToken: order.buyToken,
    receiver: order.receiver,
    sellAmount: order.sellAmount,
    buyAmount: order.buyAmount,
    validTo: order.validTo,
    appData: order.appDataHash,
    feeAmount: order.feeAmount,
    kind: order.kind,
    partiallyFillable: order.partiallyFillable,
    sellTokenBalance: order.sellTokenBalance,
    buyTokenBalance: order.buyTokenBalance
});
exports.getCowSwapOrderStruct = getCowSwapOrderStruct;
/**
 * Builds the CoW Swap order ID (`orderUid`) of `order` owned by `owner` on `chainId`: the EIP-712
 * hash of the order, followed by the owner and the order's expiry. Pre-sign and cancel
 * transactions contain only this ID, so recomputing it from an order is how we prove which order
 * such a transaction refers to. Throws if a field of `order` can't be encoded.
 */
const getCowSwapOrderUid = ({ chainId, order, owner }) => {
    const orderDigest = ethers_1.TypedDataEncoder.hash({
        name: 'Gnosis Protocol',
        version: 'v2',
        chainId,
        verifyingContract: constants_1.COWSWAP_SETTLEMENT_ADDRESS
    }, orderTypes, order);
    return (0, ethers_1.solidityPacked)(['bytes32', 'address', 'uint32'], [orderDigest, owner, order.validTo]);
};
exports.getCowSwapOrderUid = getCowSwapOrderUid;
const computeOrderUid = ({ chainId, order, owner, isEthFlow }) => {
    const orderStruct = (0, exports.getCowSwapOrderStruct)(order);
    if (!isEthFlow)
        return (0, exports.getCowSwapOrderUid)({ chainId, order: orderStruct, owner });
    return (0, exports.getCowSwapOrderUid)({
        chainId,
        order: { ...orderStruct, validTo: MAX_VALID_TO },
        owner: constants_1.COWSWAP_ETH_FLOW_ADDRESS
    });
};
exports.computeOrderUid = computeOrderUid;
const getOutputValueInUsd = ({ inputValueInUsd, toAsset, toAmount, buyAmountBeforeFees }) => {
    const priceUSD = Number(toAsset.priceUSD || 0);
    if (!priceUSD) {
        return inputValueInUsd * (Number(toAmount) / Number(buyAmountBeforeFees));
    }
    return Number((0, ethers_1.formatUnits)(toAmount, toAsset.decimals)) * priceUSD;
};
exports.getOutputValueInUsd = getOutputValueInUsd;
//# sourceMappingURL=helper.js.map