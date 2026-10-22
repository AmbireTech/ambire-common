"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cowSwapModule = void 0;
const viem_1 = require("viem");
const utils_1 = require("../utils");
const COW_SWAP_SETTLEMENT_ADDRESS = '0x9008d19f58aabd9ed0d60971565aa8510560ab41';
const getOrderUidVisualization = (orderUid, accountAddr) => {
    if (!(0, viem_1.isHex)(orderUid) || orderUid.length !== 114) {
        return [(0, utils_1.getLabel)(`with order ID ${orderUid.slice(0, 8)}...${orderUid.slice(-6)}`)];
    }
    const owner = `0x${orderUid.slice(66, 106)}`;
    const validTo = BigInt(`0x${orderUid.slice(106)}`);
    return [
        (0, utils_1.getLabel)(`with order ID ${orderUid.slice(0, 8)}...${orderUid.slice(-6)}`),
        ...(owner.toLowerCase() !== accountAddr.toLowerCase()
            ? [(0, utils_1.getLabel)('owned by'), (0, utils_1.getAddressVisualization)(owner)]
            : []),
        (0, utils_1.getDeadline)(validTo)
    ];
};
const cowSwapModule = (message) => {
    if (message.content.kind !== 'typedMessage')
        return { fullVisualization: [] };
    const tm = message.content;
    const verifyingContract = tm.domain.verifyingContract;
    if (!verifyingContract ||
        !(0, viem_1.isAddress)(verifyingContract) ||
        verifyingContract.toLowerCase() !== COW_SWAP_SETTLEMENT_ADDRESS ||
        tm.domain.name !== 'Gnosis Protocol' ||
        tm.domain.version !== 'v2') {
        return { fullVisualization: [] };
    }
    if (tm.primaryType === 'OrderCancellations' && tm.types.OrderCancellations) {
        const { orderUids } = tm.message;
        if (!Array.isArray(orderUids) || !orderUids.length)
            return { fullVisualization: [] };
        return {
            fullVisualization: [
                (0, utils_1.getAction)(orderUids.length === 1 ? 'Cancel CowSwap order' : 'Cancel CowSwap orders'),
                ...orderUids.flatMap((orderUid, index) => [
                    ...(index ? [(0, utils_1.getLabel)('and')] : []),
                    ...getOrderUidVisualization(orderUid, message.accountAddr)
                ])
            ]
        };
    }
    if (tm.primaryType !== 'Order' || !tm.types.Order)
        return { fullVisualization: [] };
    const { sellToken, buyToken, sellAmount: rawSellAmount, buyAmount: rawBuyAmount, validTo: rawValidTo, kind, receiver, feeAmount: rawFeeAmount } = tm.message;
    const sellAmount = BigInt(rawSellAmount);
    const buyAmount = BigInt(rawBuyAmount);
    const validTo = BigInt(rawValidTo);
    const feeAmount = rawFeeAmount ? BigInt(rawFeeAmount) : 0n;
    const chainId = tm.domain.chainId ? BigInt(tm.domain.chainId) : message.chainId;
    if (!(0, viem_1.isAddress)(sellToken) ||
        !(0, viem_1.isAddress)(buyToken) ||
        sellAmount === null ||
        buyAmount === null ||
        validTo === null ||
        !['buy', 'sell'].includes(kind)) {
        return { fullVisualization: [] };
    }
    const fullVisualization = kind === 'buy'
        ? [
            (0, utils_1.getAction)('Place an order to Buy'),
            (0, utils_1.getToken)(buyToken, buyAmount, chainId),
            (0, utils_1.getLabel)('for up to'),
            (0, utils_1.getToken)(sellToken, sellAmount, chainId)
        ]
        : [
            (0, utils_1.getAction)('Place an order to Sell'),
            (0, utils_1.getToken)(sellToken, sellAmount, chainId),
            (0, utils_1.getLabel)('for at least'),
            (0, utils_1.getToken)(buyToken, buyAmount, chainId)
        ];
    if (feeAmount > 0n) {
        fullVisualization.push((0, utils_1.getLabel)('including fee'), (0, utils_1.getToken)(sellToken, feeAmount, chainId));
    }
    if (typeof receiver === 'string' &&
        (0, viem_1.isAddress)(receiver) &&
        receiver.toLowerCase() !== viem_1.zeroAddress &&
        receiver.toLowerCase() !== message.accountAddr.toLowerCase()) {
        fullVisualization.push((0, utils_1.getLabel)('to'), (0, utils_1.getAddressVisualization)(receiver));
    }
    fullVisualization.push((0, utils_1.getDeadline)(validTo));
    return { fullVisualization };
};
exports.cowSwapModule = cowSwapModule;
//# sourceMappingURL=cowSwapModule.js.map