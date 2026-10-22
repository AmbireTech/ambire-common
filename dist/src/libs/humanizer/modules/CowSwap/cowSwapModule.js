"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const helper_1 = require("../../../../services/cowswap/helper");
const utils_1 = require("../../utils");
const settleAbi = [
    {
        type: 'function',
        name: 'settle',
        stateMutability: 'nonpayable',
        inputs: [
            {
                name: 'tokens',
                type: 'address[]',
                internalType: 'address[]'
            },
            {
                name: 'clearingPrices',
                type: 'uint256[]',
                internalType: 'uint256[]'
            },
            {
                name: 'trades',
                type: 'tuple[]',
                internalType: 'tuple[]',
                components: [
                    { name: 'sellTokenIndex', type: 'uint256', internalType: 'uint256' },
                    { name: 'buyTokenIndex', type: 'uint256', internalType: 'uint256' },
                    { name: 'receiver', type: 'address', internalType: 'address' },
                    { name: 'sellAmount', type: 'uint256', internalType: 'uint256' },
                    { name: 'buyAmount', type: 'uint256', internalType: 'uint256' },
                    { name: 'validTo', type: 'uint32', internalType: 'uint32' },
                    { name: 'appData', type: 'bytes32', internalType: 'bytes32' },
                    { name: 'feeAmount', type: 'uint256', internalType: 'uint256' },
                    { name: 'flags', type: 'uint256', internalType: 'uint256' },
                    { name: 'executedAmount', type: 'uint256', internalType: 'uint256' },
                    { name: 'signature', type: 'bytes', internalType: 'bytes' }
                ]
            },
            {
                name: 'interactions',
                type: 'tuple[][3]',
                internalType: 'tuple[][3]',
                components: [
                    { name: 'target', type: 'address', internalType: 'address' },
                    { name: 'value', type: 'uint256', internalType: 'uint256' },
                    { name: 'callData', type: 'bytes', internalType: 'bytes' }
                ]
            }
        ],
        outputs: []
    }
];
const COW_SWAP_SETTLEMENT_ADDRESS = '0x9008d19f58aabd9ed0d60971565aa8510560ab41';
// ComposableCoW lets an account (typically a Safe) authorize a conditional order (e.g. a TWAP)
// that CoW's off-chain watchers later fill in parts via `settle`, so the humanization here
// describes the intent that is being authorized, not any single fill
const COMPOSABLE_COW_ADDRESS = '0xfdafc9d1902f4e0b84f65f49f244b32b31013b74';
// deployed at the same address on every network CoW supports (deterministic CREATE2 deployment)
const TWAP_HANDLER_ADDRESS = '0x6cf1e9ca41f7611def408122793c358a3d11e5a5';
const conditionalOrderParamsTuple = '(address handler,bytes32 salt,bytes staticInput) params';
const createAbi = (0, viem_1.parseAbi)([`function create(${conditionalOrderParamsTuple}, bool dispatch)`]);
const createWithContextAbi = (0, viem_1.parseAbi)([
    `function createWithContext(${conditionalOrderParamsTuple}, address factory, bytes data, bool dispatch)`
]);
const twapStaticInputAbiParams = (0, viem_1.parseAbiParameters)('address sellToken, address buyToken, address receiver, uint256 partSellAmount, uint256 minPartLimit, uint256 t0, uint256 n, uint256 t, uint256 span, bytes32 appData');
const tradeTuple = '(uint256 sellTokenIndex,uint256 buyTokenIndex,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,uint256 flags,uint256 executedAmount,bytes signature)';
const swapAbi = (0, viem_1.parseAbi)([
    `function swap((bytes32 poolId,uint256 assetIn,uint256 assetOut,uint256 amount,bytes userData)[] swaps,address[] tokens,${tradeTuple} order)`
]);
const setPreSignatureAbi = (0, viem_1.parseAbi)(['function setPreSignature(bytes orderUid,bool signed)']);
const invalidateOrderAbi = (0, viem_1.parseAbi)(['function invalidateOrder(bytes orderUid)']);
const freeFilledAmountStorageAbi = (0, viem_1.parseAbi)(['function freeFilledAmountStorage(bytes[] orderUids)']);
const freePreSignatureStorageAbi = (0, viem_1.parseAbi)(['function freePreSignatureStorage(bytes[] orderUids)']);
const getTokenAtIndex = (tokens, index) => {
    if (index > BigInt(Number.MAX_SAFE_INTEGER))
        return null;
    return tokens[Number(index)] || null;
};
const getOrderUidVisualization = (orderUid) => {
    const orderDeadine = !(0, viem_1.isHex)(orderUid) || orderUid.length !== 114
        ? null
        : (0, utils_1.getDeadline)(BigInt(`0x${orderUid.slice(-8)}`));
    const shortOrderUid = `${orderUid.slice(0, 8)}...${orderUid.slice(-6)}`;
    const label = (0, utils_1.getLabel)(`with order ID ${shortOrderUid}`);
    if (orderDeadine)
        return [label, orderDeadine];
    else
        return [label];
};
const NATIVE_TOKEN_PLACEHOLDER_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
/**
 * Returns the order attached to a pre-sign or cancel call only if it hashes to `orderUid` for the
 * acting account on this network - the order ID commits to every field of the order, so a match
 * proves the attached order is exactly the one the transaction refers to.
 */
const getVerifiedOrderStruct = (accountOp, call, orderUid) => {
    const order = call.cowSwapOrder;
    if (!order || (order.kind !== 'sell' && order.kind !== 'buy'))
        return null;
    let expectedOrderUid;
    try {
        expectedOrderUid = (0, helper_1.getCowSwapOrderUid)({
            chainId: accountOp.chainId,
            order,
            owner: accountOp.accountAddr
        });
    }
    catch (error) {
        console.error('CowSwap humanizer: the order attached to the call could not be encoded', error);
        return null;
    }
    return expectedOrderUid.toLowerCase() === orderUid.toLowerCase() ? order : null;
};
const getOrderStructVisualization = (accountOp, order) => {
    const { chainId, accountAddr } = accountOp;
    const buyTokenAddress = order.buyToken.toLowerCase() === NATIVE_TOKEN_PLACEHOLDER_ADDRESS ? viem_1.zeroAddress : order.buyToken;
    const sellTokenVisualization = (0, utils_1.getToken)(order.sellToken, BigInt(order.sellAmount), chainId);
    const buyTokenVisualization = (0, utils_1.getToken)(buyTokenAddress, BigInt(order.buyAmount), chainId);
    const feeAmount = BigInt(order.feeAmount);
    const receiver = order.receiver.toLowerCase() === viem_1.zeroAddress ? accountAddr : order.receiver;
    return [
        ...(order.kind === 'sell'
            ? [sellTokenVisualization, (0, utils_1.getLabel)('for at least'), buyTokenVisualization]
            : [buyTokenVisualization, (0, utils_1.getLabel)('for at most'), sellTokenVisualization]),
        ...(feeAmount > 0n
            ? [(0, utils_1.getLabel)('plus a fee of'), (0, utils_1.getToken)(order.sellToken, feeAmount, chainId)]
            : []),
        ...(order.partiallyFillable ? [(0, utils_1.getLabel)('that can be filled in parts')] : []),
        ...(0, utils_1.getRecipientText)(accountAddr, receiver),
        (0, utils_1.getDeadline)(order.validTo)
    ];
};
const getOrderVisualization = (accountOp, tokens, order) => {
    const sellToken = getTokenAtIndex(tokens, order.sellTokenIndex);
    const buyToken = getTokenAtIndex(tokens, order.buyTokenIndex);
    if (!sellToken || !buyToken)
        return [];
    return [
        (0, utils_1.getToken)(sellToken, order.sellAmount, accountOp.chainId),
        (0, utils_1.getLabel)('for at least'),
        (0, utils_1.getToken)(buyToken, order.buyAmount, accountOp.chainId),
        ...(order.feeAmount > 0n
            ? [(0, utils_1.getLabel)('including fee'), (0, utils_1.getToken)(sellToken, order.feeAmount, accountOp.chainId)]
            : []),
        ...(0, utils_1.getRecipientText)(accountOp.accountAddr, order.receiver),
        (0, utils_1.getDeadline)(BigInt(order.validTo))
    ];
};
const getSettlementVisualization = (accountOp, tokens, trades) => {
    if (!trades.length)
        return [(0, utils_1.getAction)('Settle CowSwap orders')];
    const tradeVisualizations = trades
        .map((trade) => getOrderVisualization(accountOp, tokens, trade))
        .filter((visualization) => visualization.length);
    if (!tradeVisualizations.length)
        return [(0, utils_1.getAction)('Settle CowSwap orders')];
    return [
        (0, utils_1.getAction)(tradeVisualizations.length === 1 ? 'Settle CowSwap order' : 'Settle CowSwap orders'),
        ...tradeVisualizations.flatMap((visualization, index) => [
            ...(index ? [(0, utils_1.getLabel)('and')] : []),
            ...visualization
        ])
    ];
};
const formatDurationText = (seconds) => {
    if (seconds % 3600n === 0n) {
        const hours = seconds / 3600n;
        return `${hours} hour${hours === 1n ? '' : 's'}`;
    }
    if (seconds % 60n === 0n) {
        const minutes = seconds / 60n;
        return `${minutes} minute${minutes === 1n ? '' : 's'}`;
    }
    return `${seconds} second${seconds === 1n ? '' : 's'}`;
};
const getTwapVisualization = (accountOp, staticInput) => {
    const decoded = (0, viem_1.decodeAbiParameters)(twapStaticInputAbiParams, staticInput);
    const [sellToken, buyToken, receiver, partSellAmount, minPartLimit, t0, n, t] = decoded;
    if (n <= 0n)
        return null;
    const totalSellAmount = partSellAmount * n;
    const totalMinBuyAmount = minPartLimit * n;
    return [
        (0, utils_1.getToken)(sellToken, totalSellAmount, accountOp.chainId),
        (0, utils_1.getLabel)('for at least'),
        (0, utils_1.getToken)(buyToken, totalMinBuyAmount, accountOp.chainId),
        (0, utils_1.getLabel)(`split into ${n} parts, once every ${formatDurationText(t)}`),
        ...(t0 !== 0n ? [(0, utils_1.getLabel)(`starting ${new Date(Number(t0) * 1000).toLocaleString()}`)] : []),
        ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiver)
    ];
};
const getConditionalOrderVisualization = (accountOp, params) => {
    const handler = params.handler.toLowerCase();
    if (handler === TWAP_HANDLER_ADDRESS) {
        const twapVisualization = getTwapVisualization(accountOp, params.staticInput);
        if (twapVisualization)
            return [(0, utils_1.getAction)('Create CoW TWAP order'), ...twapVisualization];
    }
    // an unrecognized conditional order handler (e.g. a limit order or a custom strategy) -
    // we can't decode `staticInput` without knowing its shape, so at least identify the handler
    return [
        (0, utils_1.getAction)('Create CoW conditional order'),
        (0, utils_1.getLabel)('via'),
        (0, utils_1.getAddressVisualization)(handler)
    ];
};
const swapSelector = (0, viem_1.toFunctionSelector)(swapAbi[0]);
const settleSelector = (0, viem_1.toFunctionSelector)(settleAbi[0]);
const setPreSignatureSelector = (0, viem_1.toFunctionSelector)(setPreSignatureAbi[0]);
const invalidateOrderSelector = (0, viem_1.toFunctionSelector)(invalidateOrderAbi[0]);
const freeFilledAmountStorageSelector = (0, viem_1.toFunctionSelector)(freeFilledAmountStorageAbi[0]);
const freePreSignatureStorageSelector = (0, viem_1.toFunctionSelector)(freePreSignatureStorageAbi[0]);
const createSelector = (0, viem_1.toFunctionSelector)(createAbi[0]);
const createWithContextSelector = (0, viem_1.toFunctionSelector)(createWithContextAbi[0]);
// Pre-sign and cancel calls contain only the order ID. When the call carries the order it refers
// to and that order hashes to the same ID, show the order itself instead of its ID
const humanizeOrderUidCallWithVerifiedOrder = (accountOp, call) => {
    // The order ID commits to the settlement contract (it's the EIP-712 verifying contract), so a
    // matching order proves nothing about a call to any other contract
    if (!call.cowSwapOrder || call.to?.toLowerCase() !== COW_SWAP_SETTLEMENT_ADDRESS)
        return null;
    const selector = call.data.slice(0, 10);
    let orderUid;
    let isCancellation;
    if (selector === setPreSignatureSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: setPreSignatureAbi, data: call.data });
        const [decodedOrderUid, signed] = args;
        orderUid = decodedOrderUid;
        isCancellation = !signed;
    }
    else if (selector === invalidateOrderSelector) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: invalidateOrderAbi, data: call.data });
        const [decodedOrderUid] = args;
        orderUid = decodedOrderUid;
        isCancellation = true;
    }
    else {
        return null;
    }
    const order = getVerifiedOrderStruct(accountOp, call, orderUid);
    if (!order)
        return null;
    const orderVisualization = getOrderStructVisualization(accountOp, order);
    const actionVisualization = isCancellation
        ? [(0, utils_1.getAction)('Cancel CowSwap order'), (0, utils_1.getLabel)(order.kind === 'sell' ? 'to swap' : 'to buy')]
        : [(0, utils_1.getAction)(order.kind === 'sell' ? 'Swap' : 'Buy')];
    return {
        ...call,
        fullVisualization: [...actionVisualization, ...orderVisualization],
        preferredOverErc7730: true
    };
};
const CowSwapModule = (accountOp, call) => {
    const matcher = {
        [swapSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: swapAbi, data: call.data });
            const [, tokens, order] = args;
            return [(0, utils_1.getAction)('Swap'), ...getOrderVisualization(accountOp, tokens, order)];
        },
        [settleSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: settleAbi, data: call.data });
            const [tokens, , trades] = args;
            return getSettlementVisualization(accountOp, tokens, trades);
        },
        [setPreSignatureSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: setPreSignatureAbi, data: call.data });
            const [orderUid, signed] = args;
            return [
                (0, utils_1.getAction)(signed ? 'Pre-sign CowSwap order' : 'Cancel CowSwap order'),
                ...getOrderUidVisualization(orderUid)
            ];
        },
        [invalidateOrderSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: invalidateOrderAbi, data: call.data });
            const [orderUid] = args;
            return [(0, utils_1.getAction)('Cancel CowSwap order'), ...getOrderUidVisualization(orderUid)];
        },
        [freeFilledAmountStorageSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: freeFilledAmountStorageAbi, data: call.data });
            const [orderUids] = args;
            return [(0, utils_1.getAction)('Clear CowSwap filled amount storage'), (0, utils_1.getLabel)(orderUids.length)];
        },
        [freePreSignatureStorageSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: freePreSignatureStorageAbi, data: call.data });
            const [orderUids] = args;
            return [(0, utils_1.getAction)('Clear CowSwap pre-signature storage'), (0, utils_1.getLabel)(orderUids.length)];
        },
        [createSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: createAbi, data: call.data });
            const [params] = args;
            return getConditionalOrderVisualization(accountOp, params);
        },
        [createWithContextSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: createWithContextAbi, data: call.data });
            const [params] = args;
            return getConditionalOrderVisualization(accountOp, params);
        }
    };
    if (call.fullVisualization || !(0, utils_1.isHexCall)(call))
        return call;
    if (call.to?.toLowerCase() !== COW_SWAP_SETTLEMENT_ADDRESS &&
        call.to?.toLowerCase() !== COMPOSABLE_COW_ADDRESS)
        return call;
    const hexCall = { ...call, to: call.to || viem_1.zeroAddress };
    const callWithVerifiedOrder = humanizeOrderUidCallWithVerifiedOrder(accountOp, hexCall);
    if (callWithVerifiedOrder)
        return callWithVerifiedOrder;
    const match = matcher[call.data.slice(0, 10)];
    if (!match)
        return call;
    return { ...call, fullVisualization: match(hexCall) };
};
exports.default = CowSwapModule;
//# sourceMappingURL=cowSwapModule.js.map