import { Interface, ZeroAddress } from 'ethers';
import { ERC20, ERC721 } from '../../const/abis';
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils';
// @TODO merge this with the  erc20 humanizer module as sometimes
// we see no difference between the two
export const genericErc721Humanizer = (accountOp, currentIrCalls) => {
    const iface = new Interface(ERC721);
    const nftTransferVisualization = (call) => {
        const args = iface.parseTransaction(call)?.args.toArray() || [];
        return args[0] === accountOp.accountAddr
            ? [
                getAction('Send'),
                getToken(call.to, args[2]),
                getLabel('to'),
                getAddressVisualization(args[1])
            ]
            : [
                getAction('Transfer'),
                getToken(call.to, args[2]),
                getLabel('from'),
                getAddressVisualization(args[0]),
                getLabel('to'),
                getAddressVisualization(args[1])
            ];
    };
    const matcher = {
        [iface.getFunction('approve')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            return args[0] === ZeroAddress
                ? [getAction('Revoke approval'), getLabel('for'), getToken(call.to, args[1])]
                : [
                    getAction('Grant approval'),
                    getLabel('for'),
                    getToken(call.to, args[1]),
                    getLabel('to'),
                    getAddressVisualization(args[0])
                ];
        },
        [iface.getFunction('setApprovalForAll')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            return args[1]
                ? [
                    getAction('Grant approval'),
                    getLabel('for all nfts'),
                    getToken(call.to, args[1]),
                    getLabel('to'),
                    getAddressVisualization(args[0])
                ]
                : [getAction('Revoke approval'), getLabel('for all nfts'), getAddressVisualization(args[0])];
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
export const genericErc20Humanizer = (accountOp, currentIrCalls) => {
    const iface = new Interface(ERC20);
    const matcher = {
        [iface.getFunction('approve')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            return args[1] !== BigInt(0)
                ? [
                    getAction('Grant approval'),
                    getLabel('for'),
                    getToken(call.to, args[1]),
                    getLabel('to'),
                    getAddressVisualization(args[0])
                ]
                : [
                    getAction('Revoke approval'),
                    getToken(call.to, args[1]),
                    getLabel('for'),
                    getAddressVisualization(args[0])
                ];
        },
        [iface.getFunction('increaseAllowance')?.selector]: (call) => {
            const { spender, addedValue } = iface.decodeFunctionData('increaseAllowance', call.data);
            return [
                getAction('Increase allowance'),
                getLabel('of'),
                getAddressVisualization(spender),
                getLabel('with'),
                getToken(call.to, addedValue)
            ];
        },
        [iface.getFunction('decreaseAllowance')?.selector]: (call) => {
            const { spender, subtractedValue } = iface.decodeFunctionData('decreaseAllowance', call.data);
            return [
                getAction('Decrease allowance'),
                getLabel('of'),
                getAddressVisualization(spender),
                getLabel('with'),
                getToken(call.to, subtractedValue)
            ];
        },
        [iface.getFunction('transfer')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            return [
                getAction('Send'),
                getToken(call.to, args[1]),
                getLabel('to'),
                getAddressVisualization(args[0])
            ];
        },
        [iface.getFunction('transferFrom')?.selector]: (call) => {
            const args = iface.parseTransaction(call)?.args.toArray() || [];
            if (args[0] === accountOp.accountAddr) {
                return [
                    getAction('Transfer'),
                    getToken(call.to, args[2]),
                    getLabel('to'),
                    getAddressVisualization(args[1])
                ];
            }
            if (args[1] === accountOp.accountAddr) {
                return [
                    getAction('Take'),
                    getToken(call.to, args[2]),
                    getLabel('from'),
                    getAddressVisualization(args[0])
                ];
            }
            return [
                getAction('Move'),
                getToken(call.to, args[2]),
                getLabel('from'),
                getAddressVisualization(args[0]),
                getLabel('to'),
                getAddressVisualization(args[1])
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
//# sourceMappingURL=tokens.js.map