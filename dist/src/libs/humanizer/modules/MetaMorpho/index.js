"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
// MetaMorpho vaults are ERC-4626 + ERC-20 + ERC-2612 (permit) + OZ Multicall contracts.
// Users batch several actions on the vault itself (e.g. approve + deposit) through
// the vault's own `multicall(bytes[])`, so every inner call targets the vault (call.to).
const multicallAbi = (0, viem_1.parseAbi)([
    'function multicall(bytes[] data) payable returns (bytes[] results)'
]);
const erc20ApproveAbi = (0, viem_1.parseAbi)([
    'function approve(address spender, uint256 amount) returns (bool)'
]);
const erc20TransferAbi = (0, viem_1.parseAbi)(['function transfer(address to, uint256 amount) returns (bool)']);
const erc20TransferFromAbi = (0, viem_1.parseAbi)([
    'function transferFrom(address from, address to, uint256 amount) returns (bool)'
]);
const permitAbi = (0, viem_1.parseAbi)([
    'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)'
]);
const erc4626DepositAbi = (0, viem_1.parseAbi)([
    'function deposit(uint256 assets, address receiver) returns (uint256 shares)'
]);
const erc4626MintAbi = (0, viem_1.parseAbi)([
    'function mint(uint256 shares, address receiver) returns (uint256 assets)'
]);
const erc4626WithdrawAbi = (0, viem_1.parseAbi)([
    'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)'
]);
const erc4626RedeemAbi = (0, viem_1.parseAbi)([
    'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)'
]);
const innerCallMatcher = {
    [(0, viem_1.toFunctionSelector)(erc20ApproveAbi[0])]: (vault, _accAddr, data) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: erc20ApproveAbi, data: (0, utils_1.padCallData)(data, 2) });
        const [spender, amount] = args;
        if (amount === 0n)
            return {
                visualization: [
                    (0, utils_1.getAction)('Revoke approval'),
                    (0, utils_1.getToken)(vault, amount),
                    (0, utils_1.getLabel)('for'),
                    (0, utils_1.getAddressVisualization)(spender)
                ]
            };
        return {
            visualization: [
                (0, utils_1.getAction)('Grant approval'),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(vault, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(spender)
            ],
            warning: (0, utils_1.isUnlimitedAmount)(amount) ? (0, utils_1.getUnlimitedApprovalWarning)(spender) : undefined
        };
    },
    [(0, viem_1.toFunctionSelector)(permitAbi[0])]: (vault, accAddr, data) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: permitAbi, data: (0, utils_1.padCallData)(data, 7) });
        const [owner, spender, value] = args;
        return {
            visualization: [
                (0, utils_1.getAction)('Grant approval'),
                (0, utils_1.getLabel)('for'),
                (0, utils_1.getToken)(vault, value),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(spender),
                ...(0, utils_1.getOnBehalfOf)(owner, accAddr)
            ],
            warning: (0, utils_1.isUnlimitedAmount)(value) ? (0, utils_1.getUnlimitedApprovalWarning)(spender) : undefined
        };
    },
    [(0, viem_1.toFunctionSelector)(erc20TransferAbi[0])]: (vault, _accAddr, data) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: erc20TransferAbi, data: (0, utils_1.padCallData)(data, 2) });
        const [to, amount] = args;
        return {
            visualization: [
                (0, utils_1.getAction)('Send'),
                (0, utils_1.getToken)(vault, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(to)
            ]
        };
    },
    [(0, viem_1.toFunctionSelector)(erc20TransferFromAbi[0])]: (vault, _accAddr, data) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: erc20TransferFromAbi, data: (0, utils_1.padCallData)(data, 3) });
        const [from, to, amount] = args;
        return {
            visualization: [
                (0, utils_1.getAction)('Transfer'),
                (0, utils_1.getToken)(vault, amount),
                (0, utils_1.getLabel)('from'),
                (0, utils_1.getAddressVisualization)(from),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(to)
            ]
        };
    },
    [(0, viem_1.toFunctionSelector)(erc4626DepositAbi[0])]: (vault, accAddr, data) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: erc4626DepositAbi, data: (0, utils_1.padCallData)(data, 2) });
        const [assets, receiver] = args;
        return {
            visualization: [
                (0, utils_1.getAction)('Deposit into vault'),
                (0, utils_1.getToken)(vault, assets),
                ...(0, utils_1.getOnBehalfOf)(receiver, accAddr)
            ]
        };
    },
    [(0, viem_1.toFunctionSelector)(erc4626MintAbi[0])]: (vault, accAddr, data) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: erc4626MintAbi, data: (0, utils_1.padCallData)(data, 2) });
        const [shares, receiver] = args;
        return {
            visualization: [
                (0, utils_1.getAction)('Mint vault shares'),
                (0, utils_1.getToken)(vault, shares),
                ...(0, utils_1.getOnBehalfOf)(receiver, accAddr)
            ]
        };
    },
    [(0, viem_1.toFunctionSelector)(erc4626WithdrawAbi[0])]: (vault, accAddr, data) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: erc4626WithdrawAbi, data: (0, utils_1.padCallData)(data, 3) });
        const [assets, , owner] = args;
        return {
            visualization: [
                (0, utils_1.getAction)('Withdraw from vault'),
                (0, utils_1.getToken)(vault, assets),
                ...(0, utils_1.getOnBehalfOf)(owner, accAddr)
            ]
        };
    },
    [(0, viem_1.toFunctionSelector)(erc4626RedeemAbi[0])]: (vault, accAddr, data) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: erc4626RedeemAbi, data: (0, utils_1.padCallData)(data, 3) });
        const [shares, , owner] = args;
        return {
            visualization: [
                (0, utils_1.getAction)('Redeem vault shares'),
                (0, utils_1.getToken)(vault, shares),
                ...(0, utils_1.getOnBehalfOf)(owner, accAddr)
            ]
        };
    }
};
// shown as unknown without a warning on purpose: `multicall(bytes[])` is not unique to
// MetaMorpho, so an inner selector this module does not know may be an ordinary call on some
// other contract. Warning here would alarm users about calls that are not a real concern
const unmatched = () => ({
    visualization: [(0, utils_1.getAction)('Unknown call')],
    matched: false,
    warnings: []
});
const multicallSelector = (0, viem_1.toFunctionSelector)(multicallAbi[0]);
const joinWithBreaks = (decoded) => {
    const visualization = decoded.flatMap((c) => [(0, utils_1.getBreak)(), ...c.visualization]);
    visualization.shift();
    return visualization;
};
// No depth limit here on purpose: every nested bundle's calldata is part of its parent
// bundle's calldata, so it is always shorter and the recursion always stops on its own. A
// depth limit would just hide a deeply nested approval's warning from the user instead.
const decodeVaultMulticall = (vault, accAddr, innerCalls) => innerCalls.map((data) => {
    const selector = data.slice(0, 10);
    if (selector === multicallSelector) {
        try {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: multicallAbi, data });
            const [nestedCalls] = args;
            if (!nestedCalls.length)
                return unmatched();
            const nested = decodeVaultMulticall(vault, accAddr, nestedCalls);
            if (!nested.some((c) => c.matched))
                return unmatched();
            return {
                visualization: joinWithBreaks(nested),
                matched: true,
                warnings: nested.flatMap((c) => c.warnings)
            };
        }
        catch (error) {
            console.error('Failed to decode nested MetaMorpho multicall', error);
            return unmatched();
        }
    }
    const decodeInnerCall = innerCallMatcher[selector];
    if (!decodeInnerCall)
        return unmatched();
    try {
        const { visualization, warning } = decodeInnerCall(vault, accAddr, data);
        return { visualization, matched: true, warnings: warning ? [warning] : [] };
    }
    catch (error) {
        console.error('Failed to decode MetaMorpho inner call', error);
        return unmatched();
    }
});
const MetaMorphoModule = (accOp, call) => {
    if (call.fullVisualization)
        return call;
    if (!call.to)
        return call;
    if (!(0, utils_1.isHexCall)(call))
        return call;
    if (call.data.slice(0, 10) !== multicallSelector)
        return call;
    let innerCalls;
    try {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: multicallAbi, data: call.data });
        [innerCalls] = args;
    }
    catch (error) {
        console.error('Failed to decode MetaMorpho multicall', error);
        return call;
    }
    if (!innerCalls.length)
        return call;
    const decoded = decodeVaultMulticall(call.to, accOp.accountAddr, innerCalls);
    // require at least one recognized vault action before claiming this call - otherwise this
    // is some other protocol's unrelated multicall(bytes[]) (e.g. Uniswap's router) and should
    // be left for other modules / the fallback humanizer
    if (!decoded.some((c) => c.matched))
        return call;
    const fullVisualization = joinWithBreaks(decoded);
    const warnings = decoded.flatMap((c) => c.warnings);
    return { ...call, fullVisualization, warnings: (0, utils_1.mergeWarnings)(call.warnings, warnings) };
};
exports.default = MetaMorphoModule;
//# sourceMappingURL=index.js.map