"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.genericErc20Humanizer = exports.genericErc721Humanizer = void 0;
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
const utils_1 = require("../../utils");
// @TODO merge this with the  erc20 humanizer module as sometimes
// we see no difference between the two
const genericErc721Humanizer = (accountOp, currentIrCalls) => {
    const iface = new ethers_1.Interface(abis_1.ERC721);
    const nftTransferVisualization = (call) => {
        const args = iface.parseTransaction(call)?.args.toArray() || [];
        return args[0] === accountOp.accountAddr
            ? [
                (0, utils_1.getAction)('Send'),
                (0, utils_1.getToken)(call.to, args[2]),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(args[1])
            ]
            : [
                (0, utils_1.getAction)('Transfer'),
                (0, utils_1.getToken)(call.to, args[2]),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(args[0]),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(args[1])
            ];
    };
    const matcher = {
        [iface.getFunction('approve')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            return args[0] === ethers_1.ZeroAddress
                ? [(0, utils_1.getAction)('Revoke approval'), (0, utils_1.getLabel)('for'), (0, utils_1.getToken)(call.to, args[1])]
                : [
                    (0, utils_1.getAction)('Grant approval'),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(call.to, args[1]),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(args[0])
                ];
        },
        [iface.getFunction('setApprovalForAll')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            return args[1]
                ? [
                    (0, utils_1.getAction)('Grant approval'),
                    (0, utils_1.getLabel)('for all nfts'),
                    (0, utils_1.getToken)(call.to, args[1]),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(args[0])
                ]
                : [(0, utils_1.getAction)('Revoke approval'), (0, utils_1.getLabel)('for all nfts'), (0, utils_1.getAddressVisualization)(args[0])];
        },
        // not in tests
        [iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256'])?.selector]: nftTransferVisualization,
        // [`${
        //   iface.getFunction('safeTransferFrom', ['address', 'address', 'uint256', 'bytes'])
        //     ?.selector
        // }`]: nftTransferVisualization,
        [iface.getFunction('transferFrom', ['address', 'address', 'uint256'])?.selector]: nftTransferVisualization
    };
    const newCalls = currentIrCalls.map((call) => {
        // could do additional check if it is actually NFT contract
        return matcher[call.data.substring(0, 10)]
            ? {
                ...call,
                fullVisualization: matcher[call.data.substring(0, 10)](call)
            }
            : call;
    });
    return newCalls;
};
exports.genericErc721Humanizer = genericErc721Humanizer;
const genericErc20Humanizer = (accountOp, currentIrCalls) => {
    const iface = new ethers_1.Interface(abis_1.ERC20);
    const matcher = {
        [iface.getFunction('approve')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            return args[1] !== BigInt(0)
                ? [
                    (0, utils_1.getAction)('Grant approval'),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getToken)(call.to, args[1]),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(args[0])
                ]
                : [
                    (0, utils_1.getAction)('Revoke approval'),
                    (0, utils_1.getToken)(call.to, args[1]),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getAddressVisualization)(args[0])
                ];
        },
        [iface.getFunction('increaseAllowance')?.selector]: (call) => {
            const { spender, addedValue } = iface.decodeFunctionData('increaseAllowance', call.data);
            return [
                (0, utils_1.getAction)('Increase allowance'),
                (0, utils_1.getLabel)('of'),
                (0, utils_1.getAddressVisualization)(spender),
                (0, utils_1.getLabel)('with'),
                (0, utils_1.getToken)(call.to, addedValue)
            ];
        },
        [iface.getFunction('decreaseAllowance')?.selector]: (call) => {
            const { spender, subtractedValue } = iface.decodeFunctionData('decreaseAllowance', call.data);
            return [
                (0, utils_1.getAction)('Decrease allowance'),
                (0, utils_1.getLabel)('of'),
                (0, utils_1.getAddressVisualization)(spender),
                (0, utils_1.getLabel)('with'),
                (0, utils_1.getToken)(call.to, subtractedValue)
            ];
        },
        [iface.getFunction('transfer')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            return [
                (0, utils_1.getAction)('Send'),
                (0, utils_1.getToken)(call.to, args[1]),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(args[0])
            ];
        },
        [iface.getFunction('transferFrom')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            if (args[0] === accountOp.accountAddr) {
                return [
                    (0, utils_1.getAction)('Transfer'),
                    (0, utils_1.getToken)(call.to, args[2]),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getAddressVisualization)(args[1])
                ];
            }
            if (args[1] === accountOp.accountAddr) {
                return [
                    (0, utils_1.getAction)('Take'),
                    (0, utils_1.getToken)(call.to, args[2]),
                    (0, utils_1.getLabel)('from'),
                    (0, utils_1.getAddressVisualization)(args[0])
                ];
            }
            return [
                (0, utils_1.getAction)('Move'),
                (0, utils_1.getToken)(call.to, args[2]),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(args[0]),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(args[1])
            ];
        }
    };
    const newCalls = currentIrCalls.map((call) => {
        const sigHash = call.data.substring(0, 10);
        return matcher[sigHash]
            ? {
                ...call,
                fullVisualization: matcher[sigHash](call)
            }
            : call;
    });
    return newCalls;
};
exports.genericErc20Humanizer = genericErc20Humanizer;
//# sourceMappingURL=tokens.js.map