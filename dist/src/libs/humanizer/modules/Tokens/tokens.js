"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genericErc20Humanizer = exports.genericErc721Humanizer = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
// Narrowed ABIs — defined once at module level, used for typed decoding
const erc721ApproveAbi = (0, viem_1.parseAbi)(['function approve(address to, uint256 tokenId)']);
const erc721SetApprovalForAllAbi = (0, viem_1.parseAbi)([
    'function setApprovalForAll(address operator, bool approved)'
]);
const erc721SafeTransferFromAbi = (0, viem_1.parseAbi)([
    'function safeTransferFrom(address from, address to, uint256 tokenId)'
]);
const erc721TransferFromAbi = (0, viem_1.parseAbi)([
    'function transferFrom(address from, address to, uint256 tokenId)'
]);
const erc20ApproveAbi = (0, viem_1.parseAbi)([
    'function approve(address _spender, uint256 _value) returns (bool)'
]);
const erc20TransferAbi = (0, viem_1.parseAbi)(['function transfer(address _to, uint256 _value) returns (bool)']);
const erc20TransferFromAbi = (0, viem_1.parseAbi)([
    'function transferFrom(address _from, address _to, uint256 _value) returns (bool)'
]);
const erc20IncreaseAllowanceAbi = (0, viem_1.parseAbi)([
    'function increaseAllowance(address spender, uint256 addedValue) returns (bool)'
]);
const erc20DecreaseAllowanceAbi = (0, viem_1.parseAbi)([
    'function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)'
]);
// legacy naming used by some tokens (e.g. OMG) instead of increaseAllowance/decreaseAllowance
const erc20IncreaseApprovalAbi = (0, viem_1.parseAbi)([
    'function increaseApproval(address _spender, uint256 _addedValue) returns (bool)'
]);
const erc20DecreaseApprovalAbi = (0, viem_1.parseAbi)([
    'function decreaseApproval(address _spender, uint256 _subtractedValue) returns (bool)'
]);
const erc721ApproveSelector = (0, viem_1.toFunctionSelector)(erc721ApproveAbi[0]);
const erc721SetApprovalForAllSelector = (0, viem_1.toFunctionSelector)(erc721SetApprovalForAllAbi[0]);
const erc721SafeTransferFromSelector = (0, viem_1.toFunctionSelector)(erc721SafeTransferFromAbi[0]);
const erc721TransferFromSelector = (0, viem_1.toFunctionSelector)(erc721TransferFromAbi[0]);
const erc20ApproveSelector = (0, viem_1.toFunctionSelector)(erc20ApproveAbi[0]);
const erc20IncreaseAllowanceSelector = (0, viem_1.toFunctionSelector)(erc20IncreaseAllowanceAbi[0]);
const erc20DecreaseAllowanceSelector = (0, viem_1.toFunctionSelector)(erc20DecreaseAllowanceAbi[0]);
const erc20IncreaseApprovalSelector = (0, viem_1.toFunctionSelector)(erc20IncreaseApprovalAbi[0]);
const erc20DecreaseApprovalSelector = (0, viem_1.toFunctionSelector)(erc20DecreaseApprovalAbi[0]);
const erc20TransferSelector = (0, viem_1.toFunctionSelector)(erc20TransferAbi[0]);
const erc20TransferFromSelector = (0, viem_1.toFunctionSelector)(erc20TransferFromAbi[0]);
const genericErc721Humanizer = (accountOp, call) => {
    const nftTransferVisualization = (call, abi) => {
        if (!call.to)
            throw Error('Humanizer: should not be in tokens module if !call.to');
        const { args } = (0, viem_1.decodeFunctionData)({ abi, data: (0, utils_1.padCallData)(call.data, 3) });
        const [from, to, tokenId] = args;
        return from === accountOp.accountAddr
            ? [(0, utils_1.getAction)('Send'), (0, utils_1.getToken)(call.to, tokenId), (0, utils_1.getLabel)('to'), (0, utils_1.getAddressVisualization)(to)]
            : [
                (0, utils_1.getAction)('Transfer'),
                (0, utils_1.getToken)(call.to, tokenId),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(from),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(to)
            ];
    };
    const matcher = {
        [erc721ApproveSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc721ApproveAbi,
                data: (0, utils_1.padCallData)(call.data, 2)
            });
            const [to, tokenId] = args;
            return {
                visualizations: to === viem_1.zeroAddress
                    ? [(0, utils_1.getAction)('Revoke approval'), (0, utils_1.getLabel)('for'), (0, utils_1.getToken)(call.to, tokenId)]
                    : [
                        (0, utils_1.getAction)('Grant approval'),
                        (0, utils_1.getLabel)('for'),
                        (0, utils_1.getToken)(call.to, tokenId),
                        (0, utils_1.getLabel)('to'),
                        (0, utils_1.getAddressVisualization)(to)
                    ]
            };
        },
        [erc721SetApprovalForAllSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc721SetApprovalForAllAbi,
                data: (0, utils_1.padCallData)(call.data, 2)
            });
            const [operator, approved] = args;
            if (!approved)
                return {
                    visualizations: [
                        (0, utils_1.getAction)('Revoke approval'),
                        (0, utils_1.getLabel)('for all nfts from'),
                        (0, utils_1.getAddressVisualization)(call.to),
                        (0, utils_1.getLabel)('for'),
                        (0, utils_1.getAddressVisualization)(operator)
                    ]
                };
            return {
                visualizations: [
                    (0, utils_1.getAction)('Grant approval'),
                    (0, utils_1.getLabel)('for all NFTs of'),
                    (0, utils_1.getAddressVisualization)(call.to),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(operator)
                ],
                // there is no amount to check here - granting this hands over every item in the
                // collection, including items bought later, until it is revoked
                // the `warning` below already flags the whole call element; marking the action itself
                // as a warning too just makes the text harder to read without adding information
                warning: (0, utils_1.getWarning)('This app can transfer any item you own from this collection, now or later. Continue only if you trust it.', utils_1.UNLIMITED_APPROVAL_WARNING_CODE, false, operator.toLowerCase())
            };
        },
        [erc721SafeTransferFromSelector]: (call) => ({
            visualizations: nftTransferVisualization(call, erc721SafeTransferFromAbi)
        }),
        [erc721TransferFromSelector]: (call) => ({
            visualizations: nftTransferVisualization(call, erc721TransferFromAbi)
        })
    };
    if (!call.to)
        return call;
    if (!(0, utils_1.isHexCall)(call))
        return call;
    const selector = call.data.substring(0, 10);
    if (!matcher[selector])
        return call;
    const { visualizations, warning } = matcher[selector](call);
    return {
        ...call,
        fullVisualization: visualizations,
        warnings: (0, utils_1.mergeWarnings)(call.warnings, warning ? [warning] : [])
    };
};
exports.genericErc721Humanizer = genericErc721Humanizer;
const genericErc20Humanizer = ({ accountAddr }, call) => {
    // `increaseApproval` is the pre-final-EIP-20 spelling of `increaseAllowance` that some tokens
    // still use. Both raise the allowance by the amount given, so the same limit check fits each.
    const grantVisualizations = (token, spender, addedValue) => [
        (0, utils_1.getAction)('Increase allowance'),
        (0, utils_1.getLabel)('of'),
        (0, utils_1.getAddressVisualization)(spender),
        (0, utils_1.getLabel)('with'),
        (0, utils_1.getToken)(token, addedValue)
    ];
    const revokeVisualizations = (token, spender, subtractedValue) => [
        (0, utils_1.getAction)('Decrease allowance'),
        (0, utils_1.getLabel)('of'),
        (0, utils_1.getAddressVisualization)(spender),
        (0, utils_1.getLabel)('with'),
        (0, utils_1.getToken)(token, subtractedValue)
    ];
    const matcher = {
        [erc20ApproveSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc20ApproveAbi,
                data: (0, utils_1.padCallData)(call.data, 2)
            });
            const [spender, value] = args;
            if (value === 0n)
                return {
                    visualizations: [
                        (0, utils_1.getAction)('Revoke approval'),
                        (0, utils_1.getToken)(call.to, value),
                        (0, utils_1.getLabel)('for'),
                        (0, utils_1.getAddressVisualization)(spender)
                    ]
                };
            return {
                visualizations: [
                    (0, utils_1.getAction)('Grant approval'),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(call.to, value),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(spender)
                ],
                warning: (0, utils_1.isUnlimitedAmount)(value) ? (0, utils_1.getUnlimitedApprovalWarning)(spender) : undefined
            };
        },
        [erc20IncreaseAllowanceSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc20IncreaseAllowanceAbi,
                data: (0, utils_1.padCallData)(call.data, 2)
            });
            const [spender, addedValue] = args;
            return {
                visualizations: grantVisualizations(call.to, spender, addedValue),
                warning: (0, utils_1.isUnlimitedAmount)(addedValue) ? (0, utils_1.getUnlimitedApprovalWarning)(spender) : undefined
            };
        },
        [erc20DecreaseAllowanceSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc20DecreaseAllowanceAbi,
                data: (0, utils_1.padCallData)(call.data, 2)
            });
            const [spender, subtractedValue] = args;
            return { visualizations: revokeVisualizations(call.to, spender, subtractedValue) };
        },
        [erc20IncreaseApprovalSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc20IncreaseApprovalAbi,
                data: (0, utils_1.padCallData)(call.data, 2)
            });
            const [spender, addedValue] = args;
            return {
                visualizations: grantVisualizations(call.to, spender, addedValue),
                warning: (0, utils_1.isUnlimitedAmount)(addedValue) ? (0, utils_1.getUnlimitedApprovalWarning)(spender) : undefined
            };
        },
        [erc20DecreaseApprovalSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc20DecreaseApprovalAbi,
                data: (0, utils_1.padCallData)(call.data, 2)
            });
            const [spender, subtractedValue] = args;
            return { visualizations: revokeVisualizations(call.to, spender, subtractedValue) };
        },
        [erc20TransferSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc20TransferAbi,
                data: (0, utils_1.padCallData)(call.data, 2)
            });
            const [to, value] = args;
            return {
                visualizations: [
                    (0, utils_1.getAction)('Send'),
                    (0, utils_1.getToken)(call.to, value),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(to)
                ]
            };
        },
        [erc20TransferFromSelector]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc20TransferFromAbi,
                data: (0, utils_1.padCallData)(call.data, 3)
            });
            const [from, to, value] = args;
            if (from === accountAddr)
                return {
                    visualizations: [
                        (0, utils_1.getAction)('Transfer'),
                        (0, utils_1.getToken)(call.to, value),
                        (0, utils_1.getLabel)('to'),
                        (0, utils_1.getAddressVisualization)(to)
                    ]
                };
            if (to === accountAddr)
                return {
                    visualizations: [
                        (0, utils_1.getAction)('Take'),
                        (0, utils_1.getToken)(call.to, value),
                        (0, utils_1.getLabel)('from'),
                        (0, utils_1.getAddressVisualization)(from)
                    ]
                };
            return {
                visualizations: [
                    (0, utils_1.getAction)('Move'),
                    (0, utils_1.getToken)(call.to, value),
                    (0, utils_1.getLabel)('from'),
                    (0, utils_1.getAddressVisualization)(from),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(to)
                ]
            };
        }
    };
    if (!call.to)
        return call;
    if (!(0, utils_1.isHexCall)(call))
        return call;
    const sigHash = call.data.substring(0, 10);
    if (!matcher[sigHash])
        return call;
    const { visualizations, warning } = matcher[sigHash](call);
    return {
        ...call,
        fullVisualization: visualizations,
        warnings: (0, utils_1.mergeWarnings)(call.warnings, warning ? [warning] : [])
    };
};
exports.genericErc20Humanizer = genericErc20Humanizer;
//# sourceMappingURL=tokens.js.map