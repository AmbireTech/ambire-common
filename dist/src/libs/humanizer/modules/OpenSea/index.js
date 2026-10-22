"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openSeaModule = void 0;
const viem_1 = require("viem");
const richJson_1 = require("../../../richJson/richJson");
const utils_1 = require("../../utils");
const fulfillBasicOrderEfficientAbi = (0, viem_1.parseAbi)([
    'function fulfillBasicOrder_efficient_6GL6yc((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) args) payable returns (bool fulfilled)'
]);
const fulfillBasicOrderAbi = (0, viem_1.parseAbi)([
    'function fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) args) payable returns (bool fulfilled)'
]);
// using the abi as json here because otherwise viem is not able to determine the type of the first param
const fulfillAvailableAdvancedOrdersAbi = [
    {
        name: 'fulfillAvailableAdvancedOrders',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            {
                name: 'advancedOrders',
                type: 'tuple[]',
                components: [
                    {
                        name: 'parameters',
                        type: 'tuple',
                        components: [
                            { name: 'offerer', type: 'address' },
                            { name: 'zone', type: 'address' },
                            {
                                name: 'offer',
                                type: 'tuple[]',
                                components: [
                                    { name: 'itemType', type: 'uint8' },
                                    { name: 'token', type: 'address' },
                                    { name: 'identifierOrCriteria', type: 'uint256' },
                                    { name: 'startAmount', type: 'uint256' },
                                    { name: 'endAmount', type: 'uint256' }
                                ]
                            },
                            {
                                name: 'consideration',
                                type: 'tuple[]',
                                components: [
                                    { name: 'itemType', type: 'uint8' },
                                    { name: 'token', type: 'address' },
                                    { name: 'identifierOrCriteria', type: 'uint256' },
                                    { name: 'startAmount', type: 'uint256' },
                                    { name: 'endAmount', type: 'uint256' },
                                    { name: 'recipient', type: 'address' }
                                ]
                            },
                            { name: 'orderType', type: 'uint8' },
                            { name: 'startTime', type: 'uint256' },
                            { name: 'endTime', type: 'uint256' },
                            { name: 'zoneHash', type: 'bytes32' },
                            { name: 'salt', type: 'uint256' },
                            { name: 'conduitKey', type: 'bytes32' },
                            { name: 'totalOriginalConsiderationItems', type: 'uint256' }
                        ]
                    },
                    { name: 'numerator', type: 'uint120' },
                    { name: 'denominator', type: 'uint120' },
                    { name: 'signature', type: 'bytes' },
                    { name: 'extraData', type: 'bytes' }
                ]
            },
            {
                name: 'criteriaResolvers',
                type: 'tuple[]',
                components: [
                    { name: 'orderIndex', type: 'uint256' },
                    { name: 'side', type: 'uint8' },
                    { name: 'index', type: 'uint256' },
                    { name: 'identifier', type: 'uint256' },
                    { name: 'criteriaProof', type: 'bytes32[]' }
                ]
            },
            {
                name: 'offerFulfillments',
                type: 'tuple[][]',
                components: [
                    { name: 'orderIndex', type: 'uint256' },
                    { name: 'itemIndex', type: 'uint256' }
                ]
            },
            {
                name: 'considerationFulfillments',
                type: 'tuple[][]',
                components: [
                    { name: 'orderIndex', type: 'uint256' },
                    { name: 'itemIndex', type: 'uint256' }
                ]
            },
            { name: 'fulfillerConduitKey', type: 'bytes32' },
            { name: 'recipient', type: 'address' },
            { name: 'maximumFulfilled', type: 'uint256' }
        ],
        outputs: [
            { name: 'availableOrders', type: 'bool[]' },
            {
                name: 'executions',
                type: 'tuple[]',
                components: [
                    {
                        name: 'item',
                        type: 'tuple',
                        components: [
                            { name: 'itemType', type: 'uint8' },
                            { name: 'token', type: 'address' },
                            { name: 'identifier', type: 'uint256' },
                            { name: 'amount', type: 'uint256' },
                            { name: 'recipient', type: 'address' }
                        ]
                    },
                    { name: 'offerer', type: 'address' },
                    { name: 'conduitKey', type: 'bytes32' }
                ]
            }
        ]
    }
];
const fulfillAdvancedOrderAbi = (0, viem_1.parseAbi)([
    'function fulfillAdvancedOrder(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, uint120 numerator, uint120 denominator, bytes signature, bytes extraData), (uint256 orderIndex, uint8 side, uint256 index, uint256 identifier, bytes32[] criteriaProof)[], bytes32 fulfillerConduitKey, address recipient) payable returns (bool fulfilled)'
]);
const parsePrice = (price, numerator, denumerator) => BigInt((price * numerator) / denumerator);
const parseOrder = (order) => {
    const { parameters: params, numerator: num, denominator: denum } = order;
    const { offer: offers, consideration, endTime } = params;
    const items = offers.map((o) => {
        const { token: address, identifierOrCriteria: id, startAmount: fromAmount, endAmount } = o;
        return {
            address,
            id,
            fromAmount: parsePrice(fromAmount, num, denum),
            endAmount: parsePrice(endAmount, num, denum)
        };
    });
    const payment = [];
    const tokenPayments = {};
    consideration.forEach((o) => {
        const { itemType: type, token, identifierOrCriteria: tokenId, endAmount } = o;
        if (Number(type) === 0 || Number(type) === 1)
            tokenPayments[token] = (tokenPayments[token] || 0n) + parsePrice(endAmount, num, denum);
        if (Number(type) === 2 || Number(type) === 3)
            payment.push({ address: token, amountOrId: BigInt(tokenId) });
    });
    Object.entries(tokenPayments).forEach(([address, amountOrId]) => {
        payment.push({ address, amountOrId });
    });
    return { items, payment, end: BigInt(endTime) };
};
const dedupe1155Orders = (orders) => {
    if (!orders[0] || orders.length <= 30)
        return orders;
    const uniqueOrders = [...new Set(orders.map((o) => (0, richJson_1.stringify)(o)))];
    if (uniqueOrders.length > 1)
        return orders;
    if (orders[0].items.length > 1)
        return orders;
    if (orders[0].payment.length > 1)
        return orders;
    // if (uniqueOrders.items.length > 1) return orders
    const correctNumberOfOrders = BigInt(orders.length - 30);
    const finalOrder = orders[0];
    if (!finalOrder.items[0])
        return orders;
    if (!finalOrder.payment[0])
        return orders;
    finalOrder.items[0].endAmount *= correctNumberOfOrders;
    finalOrder.items[0].fromAmount *= correctNumberOfOrders;
    finalOrder.payment[0].amountOrId *= correctNumberOfOrders;
    return [finalOrder];
};
const humanizerOrder = ({ items, payment, end }) => {
    return [
        (0, utils_1.getAction)('Buy'),
        ...items
            .map(({ address, id, fromAmount }) => fromAmount === 1n
            ? [(0, utils_1.getToken)(address, id)]
            : [(0, utils_1.getLabel)(fromAmount.toString(), true), (0, utils_1.getToken)(address, id)])
            .flat(),
        (0, utils_1.getLabel)('for up to'),
        ...payment.map(({ address, amountOrId }) => (0, utils_1.getToken)(address, amountOrId)),
        (0, utils_1.getDeadline)(end)
    ];
};
const fulfillBasicOrderEfficientSelector = (0, viem_1.toFunctionSelector)(fulfillBasicOrderEfficientAbi[0]);
const fulfillBasicOrderSelector = (0, viem_1.toFunctionSelector)(fulfillBasicOrderAbi[0]);
const fulfillAvailableAdvancedOrdersSelector = (0, viem_1.toFunctionSelector)(fulfillAvailableAdvancedOrdersAbi[0]);
const fulfillAdvancedOrderSelector = (0, viem_1.toFunctionSelector)(fulfillAdvancedOrderAbi[0]);
const openSeaModule = (accountOp, call) => {
    if (!call.to || !(0, utils_1.isHexCall)(call))
        return call;
    if ([fulfillBasicOrderEfficientSelector, fulfillBasicOrderSelector].some((sel) => call.data.startsWith(sel))) {
        let argsParam;
        if (call.data.startsWith(fulfillBasicOrderSelector)) {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: fulfillBasicOrderAbi, data: call.data });
            argsParam = args[0];
        }
        else {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: fulfillBasicOrderEfficientAbi,
                data: call.data
            });
            argsParam = args[0];
        }
        const { considerationToken, considerationAmount, offerToken, offerIdentifier, endTime } = argsParam;
        return {
            ...call,
            fullVisualization: [
                (0, utils_1.getAction)('Buy'),
                (0, utils_1.getToken)(offerToken, offerIdentifier),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(considerationToken, considerationAmount),
                (0, utils_1.getDeadline)(endTime)
            ]
        };
    }
    if (call.data.startsWith(fulfillAvailableAdvancedOrdersSelector)) {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: fulfillAvailableAdvancedOrdersAbi,
            data: call.data
        });
        const [orders] = args;
        let totalOrders = orders.map((o) => parseOrder(o));
        // opensea allows batch buy of 30 items at most
        // if we detect more than 30 orders, that means the dapp attempts to
        // execute n-30 EIP1155 orders that are being deduplicated accordingly on a contract level
        // dedupe1155Orders removes 30 repeating orders and merges the remaining n orders
        if (totalOrders.length > 30)
            totalOrders = dedupe1155Orders(totalOrders);
        // still not deduped
        if (totalOrders.length > 30)
            return {
                ...call,
                fullVisualization: [
                    (0, utils_1.getAction)('Buy NFTs'),
                    (0, utils_1.getLabel)('from'),
                    (0, utils_1.getAddressVisualization)(call.to)
                ]
            };
        const fullVisualization = totalOrders.map(humanizerOrder).flat();
        return { ...call, fullVisualization };
    }
    if (call.data.startsWith(fulfillAdvancedOrderSelector)) {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: fulfillAdvancedOrderAbi,
            data: call.data
        });
        const [order] = args;
        const parsedOrder = parseOrder(order);
        const fullVisualization = humanizerOrder(parsedOrder);
        return { ...call, fullVisualization };
    }
    return call;
};
exports.openSeaModule = openSeaModule;
//# sourceMappingURL=index.js.map