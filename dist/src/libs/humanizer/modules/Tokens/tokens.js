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
const genericErc721Humanizer = (accountOp, currentIrCalls) => {
    const nftTransferVisualization = (call, abi) => {
        if (!call.to)
            throw Error('Humanizer: should not be in tokens module if !call.to');
        const { args } = (0, viem_1.decodeFunctionData)({ abi, data: call.data });
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
        [(0, viem_1.toFunctionSelector)(erc721ApproveAbi[0])]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: erc721ApproveAbi, data: call.data });
            const [to, tokenId] = args;
            return to === viem_1.zeroAddress
                ? [(0, utils_1.getAction)('Revoke approval'), (0, utils_1.getLabel)('for'), (0, utils_1.getToken)(call.to, tokenId)]
                : [
                    (0, utils_1.getAction)('Grant approval'),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(call.to, tokenId),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(to)
                ];
        },
        [(0, viem_1.toFunctionSelector)(erc721SetApprovalForAllAbi[0])]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc721SetApprovalForAllAbi,
                data: call.data
            });
            const [operator, approved] = args;
            return approved
                ? [
                    (0, utils_1.getAction)('Grant approval', { warning: true }),
                    (0, utils_1.getLabel)('for all NFTs of'),
                    (0, utils_1.getAddressVisualization)(call.to),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(operator)
                ]
                : [
                    (0, utils_1.getAction)('Revoke approval'),
                    (0, utils_1.getLabel)('for all nfts from'),
                    (0, utils_1.getAddressVisualization)(call.to),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getAddressVisualization)(operator)
                ];
        },
        [(0, viem_1.toFunctionSelector)(erc721SafeTransferFromAbi[0])]: (call) => nftTransferVisualization(call, erc721SafeTransferFromAbi),
        [(0, viem_1.toFunctionSelector)(erc721TransferFromAbi[0])]: (call) => nftTransferVisualization(call, erc721TransferFromAbi)
    };
    return currentIrCalls.map((call) => {
        if (!call.to)
            return call;
        if (!(0, utils_1.isHexCall)(call))
            return call;
        const selector = call.data.substring(0, 10);
        return matcher[selector] ? { ...call, fullVisualization: matcher[selector](call) } : call;
    });
};
exports.genericErc721Humanizer = genericErc721Humanizer;
const genericErc20Humanizer = ({ accountAddr }, currentIrCalls) => {
    const matcher = {
        [(0, viem_1.toFunctionSelector)(erc20ApproveAbi[0])]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: erc20ApproveAbi, data: call.data });
            const [spender, value] = args;
            return value !== 0n
                ? [
                    (0, utils_1.getAction)('Grant approval'),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(call.to, value),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(spender)
                ]
                : [
                    (0, utils_1.getAction)('Revoke approval'),
                    (0, utils_1.getToken)(call.to, value),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getAddressVisualization)(spender)
                ];
        },
        [(0, viem_1.toFunctionSelector)(erc20IncreaseAllowanceAbi[0])]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc20IncreaseAllowanceAbi,
                data: call.data
            });
            const [spender, addedValue] = args;
            return [
                (0, utils_1.getAction)('Increase allowance'),
                (0, utils_1.getLabel)('of'),
                (0, utils_1.getAddressVisualization)(spender),
                (0, utils_1.getLabel)('with'),
                (0, utils_1.getToken)(call.to, addedValue)
            ];
        },
        [(0, viem_1.toFunctionSelector)(erc20DecreaseAllowanceAbi[0])]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: erc20DecreaseAllowanceAbi,
                data: call.data
            });
            const [spender, subtractedValue] = args;
            return [
                (0, utils_1.getAction)('Decrease allowance'),
                (0, utils_1.getLabel)('of'),
                (0, utils_1.getAddressVisualization)(spender),
                (0, utils_1.getLabel)('with'),
                (0, utils_1.getToken)(call.to, subtractedValue)
            ];
        },
        [(0, viem_1.toFunctionSelector)(erc20TransferAbi[0])]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: erc20TransferAbi, data: call.data });
            const [to, value] = args;
            return [
                (0, utils_1.getAction)('Send'),
                (0, utils_1.getToken)(call.to, value),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(to)
            ];
        },
        [(0, viem_1.toFunctionSelector)(erc20TransferFromAbi[0])]: (call) => {
            if (!call.to)
                throw Error('Humanizer: should not be in tokens module if !call.to');
            const { args } = (0, viem_1.decodeFunctionData)({ abi: erc20TransferFromAbi, data: call.data });
            const [from, to, value] = args;
            if (from === accountAddr)
                return [
                    (0, utils_1.getAction)('Transfer'),
                    (0, utils_1.getToken)(call.to, value),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(to)
                ];
            if (to === accountAddr)
                return [
                    (0, utils_1.getAction)('Take'),
                    (0, utils_1.getToken)(call.to, value),
                    (0, utils_1.getLabel)('from'),
                    (0, utils_1.getAddressVisualization)(from)
                ];
            return [
                (0, utils_1.getAction)('Move'),
                (0, utils_1.getToken)(call.to, value),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(from),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(to)
            ];
        }
    };
    return currentIrCalls.map((call) => {
        if (!call.to)
            return call;
        if (!(0, utils_1.isHexCall)(call))
            return call;
        const sigHash = call.data.substring(0, 10);
        return matcher[sigHash] ? { ...call, fullVisualization: matcher[sigHash](call) } : call;
    });
};
exports.genericErc20Humanizer = genericErc20Humanizer;
//# sourceMappingURL=tokens.js.map