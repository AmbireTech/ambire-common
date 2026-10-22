"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const generalAdapter_1 = require("./generalAdapter");
const multicallAbi = [
    {
        type: 'function',
        name: 'multicall',
        inputs: [
            {
                name: 'bundle',
                type: 'tuple[]',
                internalType: 'tuple[]',
                components: [
                    { name: 'to', type: 'address', internalType: 'address' },
                    { name: 'data', type: 'bytes', internalType: 'bytes' },
                    { name: 'value', type: 'uint256', internalType: 'uint256' },
                    { name: 'skipRevert', type: 'bool', internalType: 'bool' },
                    { name: 'callbackHash', type: 'bytes32', internalType: 'bytes32' }
                ]
            }
        ],
        outputs: [],
        stateMutability: 'payable'
    }
];
const morphoSupplyCollateralSelector = (0, viem_1.toFunctionSelector)(generalAdapter_1.morphoSupplyCollateralAbi[0]);
const morphoBorrowSelector = (0, viem_1.toFunctionSelector)(generalAdapter_1.morphoBorrowAbi[0]);
const morphoRepaySelector = (0, viem_1.toFunctionSelector)(generalAdapter_1.morphoRepayAbi[0]);
const morphoWithdrawCollateralSelector = (0, viem_1.toFunctionSelector)(generalAdapter_1.morphoWithdrawCollateralAbi[0]);
const morphoFlashLoanSelector = (0, viem_1.toFunctionSelector)(generalAdapter_1.morphoFlashLoanAbi[0]);
const erc4626MintSelector = (0, viem_1.toFunctionSelector)(generalAdapter_1.erc4626MintAbi[0]);
const erc4626DepositSelector = (0, viem_1.toFunctionSelector)(generalAdapter_1.erc4626DepositAbi[0]);
const erc4626WithdrawSelector = (0, viem_1.toFunctionSelector)(generalAdapter_1.erc4626WithdrawAbi[0]);
const erc4626RedeemSelector = (0, viem_1.toFunctionSelector)(generalAdapter_1.erc4626RedeemAbi[0]);
const multicallSelector = (0, viem_1.toFunctionSelector)(multicallAbi[0]);
const decodeGeneralAdapter = (accAddr, bundle) => {
    const matcher = {
        // the below commented out humanizations are legit multicall humanizations
        // but they don't bring any value to the user other than confusion
        //
        // [toFunctionSelector(erc20TransferFromAbi[0])]: ...
        // [toFunctionSelector(erc20TransferAbi[0])]: ...
        // [toFunctionSelector(nativeTransferAbi[0])]: ...
        // [toFunctionSelector(wrapNativeAbi[0])]: ...
        // [toFunctionSelector(unwrapNativeAbi[0])]: ...
        // [toFunctionSelector(permit2TransferFromAbi[0])]: ...
        [morphoSupplyCollateralSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: generalAdapter_1.morphoSupplyCollateralAbi,
                data: call.data
            });
            const [marketParams, assets, onBehalf] = args;
            const collateral = marketParams.collateralToken;
            const fullVisualization = [(0, utils_1.getBreak)(), (0, utils_1.getAction)('Supply'), (0, utils_1.getToken)(collateral, assets)];
            return { ...call, fullVisualization, warnings: (0, generalAdapter_1.getWarnings)(accAddr, onBehalf) };
        },
        [morphoBorrowSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: generalAdapter_1.morphoBorrowAbi,
                data: (0, utils_1.padCallData)(call.data, 9)
            });
            const [marketParams, assets, , , receiver] = args;
            const loanToken = marketParams.loanToken;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Take'),
                (0, utils_1.getToken)(loanToken, assets),
                (0, utils_1.getLabel)('loan')
            ];
            return { ...call, fullVisualization, warnings: (0, generalAdapter_1.getWarnings)(accAddr, receiver) };
        },
        [morphoRepaySelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: generalAdapter_1.morphoRepayAbi,
                data: call.data
            });
            const [marketParams, assets, , , onBehalf] = args;
            const loanToken = marketParams.loanToken;
            const fullVisualization = [(0, utils_1.getBreak)(), (0, utils_1.getAction)('Repay'), (0, utils_1.getToken)(loanToken, assets)];
            return { ...call, fullVisualization, warnings: (0, generalAdapter_1.getWarnings)(accAddr, onBehalf) };
        },
        [morphoWithdrawCollateralSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: generalAdapter_1.morphoWithdrawCollateralAbi,
                data: (0, utils_1.padCallData)(call.data, 7)
            });
            const [marketParams, assets, receiver] = args;
            const collateralToken = marketParams.collateralToken;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Withdraw'),
                (0, utils_1.getToken)(collateralToken, assets)
            ];
            return { ...call, fullVisualization, warnings: (0, generalAdapter_1.getWarnings)(accAddr, receiver) };
        },
        [morphoFlashLoanSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: generalAdapter_1.morphoFlashLoanAbi,
                data: call.data
            });
            const [token, assets] = args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Execute flash loan for'),
                (0, utils_1.getToken)(token, assets)
            ];
            return { ...call, fullVisualization };
        },
        [erc4626MintSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: generalAdapter_1.erc4626MintAbi,
                data: (0, utils_1.padCallData)(call.data, 4)
            });
            const [vault, , , receiver] = args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Supply to vault'),
                (0, utils_1.getAddressVisualization)(vault)
            ];
            return { ...call, fullVisualization, warnings: (0, generalAdapter_1.getWarnings)(accAddr, receiver) };
        },
        [erc4626DepositSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: generalAdapter_1.erc4626DepositAbi,
                data: (0, utils_1.padCallData)(call.data, 4)
            });
            const [vault, , , receiver] = args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Mint from vault'),
                (0, utils_1.getAddressVisualization)(vault)
            ];
            return { ...call, fullVisualization, warnings: (0, generalAdapter_1.getWarnings)(accAddr, receiver) };
        },
        [erc4626WithdrawSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: generalAdapter_1.erc4626WithdrawAbi,
                data: (0, utils_1.padCallData)(call.data, 5)
            });
            const [vault, , , receiver] = args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Withdraw from vault'),
                (0, utils_1.getAddressVisualization)(vault)
            ];
            return { ...call, fullVisualization, warnings: (0, generalAdapter_1.getWarnings)(accAddr, receiver) };
        },
        [erc4626RedeemSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({
                abi: generalAdapter_1.erc4626RedeemAbi,
                data: (0, utils_1.padCallData)(call.data, 5)
            });
            const [vault, , , receiver] = args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Withdraw from vault'),
                (0, utils_1.getAddressVisualization)(vault)
            ];
            return { ...call, fullVisualization, warnings: (0, generalAdapter_1.getWarnings)(accAddr, receiver) };
        }
    };
    return bundle.map((call) => {
        const match = matcher[call.data.slice(0, 10)];
        if (!match)
            return call;
        const newCall = match(call);
        if (!newCall)
            return call;
        return newCall;
    });
};
const Bundler3Module = (accOp, call) => {
    const matcher = {
        [multicallSelector]: (call) => {
            if (!call.to)
                return;
            if (call.value)
                return;
            if (!(0, utils_1.isHexCall)(call))
                return;
            const { args } = (0, viem_1.decodeFunctionData)({ abi: multicallAbi, data: call.data });
            const [bundle] = args;
            const decodedBundle = decodeGeneralAdapter(accOp.accountAddr, bundle);
            const bundleVisualization = decodedBundle.map((c) => c.fullVisualization || []).flat();
            if (bundleVisualization.length)
                bundleVisualization.shift();
            return {
                ...call,
                fullVisualization: bundleVisualization.length ? bundleVisualization : undefined
            };
        }
    };
    const match = matcher[call.data.slice(0, 10)];
    if (call.fullVisualization || !match)
        return call;
    const newCall = match(call);
    if (!newCall)
        return call;
    return newCall;
};
exports.default = Bundler3Module;
//# sourceMappingURL=index.js.map