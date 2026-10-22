"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeGeneralAdapter = exports.decodeGeneralAdapterCall = exports.getWarnings = exports.publicAllocatorReallocateToAbi = exports.erc4626RedeemAbi = exports.erc4626WithdrawAbi = exports.erc4626DepositAbi = exports.erc4626MintAbi = exports.morphoFlashLoanAbi = exports.morphoWithdrawCollateralAbi = exports.morphoRepayAbi = exports.morphoBorrowAbi = exports.morphoSupplyCollateralAbi = exports.permit2TransferFromAbi = exports.unwrapNativeAbi = exports.wrapNativeAbi = exports.nativeTransferAbi = exports.erc20TransferAbi = exports.erc20TransferFromAbi = void 0;
const viem_1 = require("viem");
const utils_1 = require("../../utils");
exports.erc20TransferFromAbi = (0, viem_1.parseAbi)([
    'function erc20TransferFrom(address token, address receiver, uint256 amount)'
]);
exports.erc20TransferAbi = (0, viem_1.parseAbi)([
    'function erc20Transfer(address token, address receiver, uint256 amount)'
]);
exports.nativeTransferAbi = (0, viem_1.parseAbi)([
    'function nativeTransfer(address receiver, uint256 amount)'
]);
exports.wrapNativeAbi = (0, viem_1.parseAbi)(['function wrapNative(uint256 amount)']);
exports.unwrapNativeAbi = (0, viem_1.parseAbi)(['function unwrapNative(uint256 amount)']);
exports.permit2TransferFromAbi = (0, viem_1.parseAbi)([
    'function permit2TransferFrom(address token, address receiver, uint256 amount)'
]);
exports.morphoSupplyCollateralAbi = (0, viem_1.parseAbi)([
    'function morphoSupplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)'
]);
exports.morphoBorrowAbi = (0, viem_1.parseAbi)([
    'function morphoBorrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, uint256 minSharePriceE27, address receiver)'
]);
exports.morphoRepayAbi = (0, viem_1.parseAbi)([
    'function morphoRepay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, uint256 maxSharePriceE27, address onBehalf, bytes data)'
]);
exports.morphoWithdrawCollateralAbi = (0, viem_1.parseAbi)([
    'function morphoWithdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address receiver)'
]);
exports.morphoFlashLoanAbi = (0, viem_1.parseAbi)([
    'function morphoFlashLoan(address token, uint256 assets, bytes data)'
]);
exports.erc4626MintAbi = (0, viem_1.parseAbi)([
    'function erc4626Mint(address vault, uint256 shares, uint256 maxSharePriceE27, address receiver)'
]);
exports.erc4626DepositAbi = (0, viem_1.parseAbi)([
    'function erc4626Deposit(address vault, uint256 assets, uint256 maxSharePriceE27, address receiver)'
]);
exports.erc4626WithdrawAbi = (0, viem_1.parseAbi)([
    'function erc4626Withdraw(address vault, uint256 assets, uint256 minSharePriceE27, address receiver, address owner)'
]);
exports.erc4626RedeemAbi = (0, viem_1.parseAbi)([
    'function erc4626Redeem(address vault, uint256 shares, uint256 minSharePriceE27, address receiver, address owner)'
]);
exports.publicAllocatorReallocateToAbi = (0, viem_1.parseAbi)([
    'function reallocateTo(address vault, ((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint128 amount)[] withdrawals, (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) supplyMarketParams) payable'
]);
const getWarnings = (accAddr, onBehalf) => {
    return onBehalf.toLowerCase() !== accAddr.toLowerCase()
        ? [
            (0, utils_1.getWarning)(`Differnt action address detected! Owner is ${accAddr}, while action address is ${onBehalf}`, 'Morpho_diff_addr')
        ]
        : [];
};
exports.getWarnings = getWarnings;
const toRepayAssets = (assets, shares, maxSharePriceE27) => {
    if (assets > 0n)
        return assets;
    if (shares <= 0n || maxSharePriceE27 <= 0n)
        return assets;
    const precision = 10n ** 27n;
    return (shares * maxSharePriceE27 + precision - 1n) / precision;
};
const matcher = {
    [(0, viem_1.toFunctionSelector)(exports.erc20TransferFromAbi[0])]: (_accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: exports.erc20TransferFromAbi,
            data: (0, utils_1.padCallData)(call.data, 3)
        });
        const [token, receiver, amount] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Transfer'),
            (0, utils_1.getToken)(token, amount),
            (0, utils_1.getLabel)('To'),
            (0, utils_1.getAddressVisualization)(receiver)
        ];
        return { ...call, fullVisualization };
    },
    [(0, viem_1.toFunctionSelector)(exports.erc20TransferAbi[0])]: (_accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.erc20TransferAbi, data: (0, utils_1.padCallData)(call.data, 3) });
        const [token, receiver, amount] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Transfer'),
            (0, utils_1.getToken)(token, amount),
            (0, utils_1.getLabel)('To'),
            (0, utils_1.getAddressVisualization)(receiver)
        ];
        return { ...call, fullVisualization };
    },
    [(0, viem_1.toFunctionSelector)(exports.nativeTransferAbi[0])]: (_accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.nativeTransferAbi, data: (0, utils_1.padCallData)(call.data, 2) });
        const [receiver, amount] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Transfer'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('To'),
            (0, utils_1.getAddressVisualization)(receiver)
        ];
        return { ...call, fullVisualization };
    },
    [(0, viem_1.toFunctionSelector)(exports.wrapNativeAbi[0])]: (_accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.wrapNativeAbi, data: (0, utils_1.padCallData)(call.data, 1) });
        const [amount] = args;
        const fullVisualization = [(0, utils_1.getBreak)(), ...(0, utils_1.getWrapping)(viem_1.zeroAddress, amount)];
        return { ...call, fullVisualization };
    },
    [(0, viem_1.toFunctionSelector)(exports.unwrapNativeAbi[0])]: (_accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.unwrapNativeAbi, data: (0, utils_1.padCallData)(call.data, 1) });
        const [amount] = args;
        const fullVisualization = [(0, utils_1.getBreak)(), ...(0, utils_1.getUnwrapping)(viem_1.zeroAddress, amount)];
        return { ...call, fullVisualization };
    },
    [(0, viem_1.toFunctionSelector)(exports.permit2TransferFromAbi[0])]: (_accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: exports.permit2TransferFromAbi,
            data: (0, utils_1.padCallData)(call.data, 3)
        });
        const [token, receiver, amount] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Transfer'),
            (0, utils_1.getToken)(token, amount),
            (0, utils_1.getLabel)('To'),
            (0, utils_1.getAddressVisualization)(receiver)
        ];
        return { ...call, fullVisualization };
    },
    [(0, viem_1.toFunctionSelector)(exports.morphoSupplyCollateralAbi[0])]: (accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.morphoSupplyCollateralAbi, data: call.data });
        const [marketParams, assets, onBehalf] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Supply'),
            (0, utils_1.getToken)(marketParams.collateralToken, assets)
        ];
        return { ...call, fullVisualization, warnings: (0, exports.getWarnings)(accAddr, onBehalf) };
    },
    [(0, viem_1.toFunctionSelector)(exports.morphoBorrowAbi[0])]: (accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.morphoBorrowAbi, data: (0, utils_1.padCallData)(call.data, 9) });
        const [marketParams, assets, , , receiver] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Borrow'),
            (0, utils_1.getToken)(marketParams.loanToken, assets)
        ];
        return { ...call, fullVisualization, warnings: (0, exports.getWarnings)(accAddr, receiver) };
    },
    [(0, viem_1.toFunctionSelector)(exports.morphoRepayAbi[0])]: (accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.morphoRepayAbi, data: call.data });
        const [marketParams, assets, shares, maxSharePriceE27, onBehalf] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Repay'),
            (0, utils_1.getToken)(marketParams.loanToken, toRepayAssets(assets, shares, maxSharePriceE27))
        ];
        return { ...call, fullVisualization, warnings: (0, exports.getWarnings)(accAddr, onBehalf) };
    },
    [(0, viem_1.toFunctionSelector)(exports.morphoWithdrawCollateralAbi[0])]: (accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: exports.morphoWithdrawCollateralAbi,
            data: (0, utils_1.padCallData)(call.data, 7)
        });
        const [marketParams, assets, receiver] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Withdraw'),
            (0, utils_1.getToken)(marketParams.collateralToken, assets)
        ];
        return { ...call, fullVisualization, warnings: (0, exports.getWarnings)(accAddr, receiver) };
    },
    [(0, viem_1.toFunctionSelector)(exports.morphoFlashLoanAbi[0])]: (_accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.morphoFlashLoanAbi, data: call.data });
        const [token, assets] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Execute flash loan for'),
            (0, utils_1.getToken)(token, assets)
        ];
        return { ...call, fullVisualization };
    },
    [(0, viem_1.toFunctionSelector)(exports.erc4626MintAbi[0])]: (accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.erc4626MintAbi, data: (0, utils_1.padCallData)(call.data, 4) });
        const [vault, , , receiver] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Supply to vault'),
            (0, utils_1.getAddressVisualization)(vault)
        ];
        return { ...call, fullVisualization, warnings: (0, exports.getWarnings)(accAddr, receiver) };
    },
    [(0, viem_1.toFunctionSelector)(exports.erc4626DepositAbi[0])]: (accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.erc4626DepositAbi, data: (0, utils_1.padCallData)(call.data, 4) });
        const [vault, , , receiver] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Mint from vault'),
            (0, utils_1.getAddressVisualization)(vault)
        ];
        return { ...call, fullVisualization, warnings: (0, exports.getWarnings)(accAddr, receiver) };
    },
    [(0, viem_1.toFunctionSelector)(exports.erc4626WithdrawAbi[0])]: (accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: exports.erc4626WithdrawAbi,
            data: (0, utils_1.padCallData)(call.data, 5)
        });
        const [vault, , , receiver] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Withdraw from vault'),
            (0, utils_1.getAddressVisualization)(vault)
        ];
        return { ...call, fullVisualization, warnings: (0, exports.getWarnings)(accAddr, receiver) };
    },
    [(0, viem_1.toFunctionSelector)(exports.erc4626RedeemAbi[0])]: (accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.erc4626RedeemAbi, data: (0, utils_1.padCallData)(call.data, 5) });
        const [vault, , , receiver] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Withdraw from vault'),
            (0, utils_1.getAddressVisualization)(vault)
        ];
        return { ...call, fullVisualization, warnings: (0, exports.getWarnings)(accAddr, receiver) };
    },
    [(0, viem_1.toFunctionSelector)(exports.publicAllocatorReallocateToAbi[0])]: (_accAddr, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: exports.publicAllocatorReallocateToAbi, data: call.data });
        const [vault] = args;
        const fullVisualization = [
            (0, utils_1.getBreak)(),
            (0, utils_1.getAction)('Reallocate liquidity'),
            (0, utils_1.getLabel)('To vault'),
            (0, utils_1.getAddressVisualization)(vault)
        ];
        return { ...call, fullVisualization };
    }
};
const decodeGeneralAdapterCall = (accAddr, call) => {
    if (!(0, utils_1.isHexCall)(call))
        return call;
    const match = matcher[call.data.slice(0, 10)];
    if (!match)
        return call;
    try {
        return match(accAddr, call) || call;
    }
    catch (error) {
        console.error('Failed to decode GeneralAdapter calldata', error);
        return call;
    }
};
exports.decodeGeneralAdapterCall = decodeGeneralAdapterCall;
const decodeGeneralAdapter = (accAddr, bundle) => bundle.map((call) => (0, exports.decodeGeneralAdapterCall)(accAddr, call));
exports.decodeGeneralAdapter = decodeGeneralAdapter;
//# sourceMappingURL=generalAdapter.js.map