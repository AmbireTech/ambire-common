"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const Bundler3_1 = require("../../const/abis/Bundler3");
const GeneralAdapter1_1 = require("../../const/abis/GeneralAdapter1");
const utils_1 = require("../../utils");
const iface = new ethers_1.Interface(Bundler3_1.Bundler3);
const generalAdapterInterface = new ethers_1.Interface(GeneralAdapter1_1.GeneralAdapter1);
const getWarnings = (accAddr, onBehalf) => {
    return onBehalf.toLowerCase() !== accAddr.toLowerCase()
        ? [
            (0, utils_1.getWarning)(`Differnt action address detected! Owner is ${accAddr}, while action address is ${onBehalf}`, 'Morpho_diff_addr')
        ]
        : [];
};
const decodeGeneralAdapter = (accAddr, bundle) => {
    const matcher = {
        // the below commented out humanizations are legit multicall humanizations
        // but they don't bring any value to the user other than confusion
        //
        // [generalAdapterInterface.getFunction('erc20TransferFrom')?.selector!]: (
        //   call: IrCall
        // ): IrCall | undefined => {
        //   const { token, receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
        //   const fullVisualization = [
        //     getBreak(),
        //     getAction('Transfer'),
        //     getToken(token, amount),
        //     getLabel('To'),
        //     getAddressVisualization(receiver)
        //   ]
        //   return { ...call, fullVisualization }
        // },
        // [generalAdapterInterface.getFunction('erc20Transfer')?.selector!]: (
        //   call: IrCall
        // ): IrCall | undefined => {
        //   const { token, receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
        //   const fullVisualization = [
        //     getBreak(),
        //     getAction('Transfer'),
        //     getToken(token, amount),
        //     getLabel('To'),
        //     getAddressVisualization(receiver)
        //   ]
        //   return { ...call, fullVisualization }
        // },
        // [generalAdapterInterface.getFunction('nativeTransfer')?.selector!]: (
        //   call: IrCall
        // ): IrCall | undefined => {
        //   const { receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
        //   const fullVisualization = [
        //     getBreak(),
        //     getAction('Transfer'),
        //     getToken(ZeroAddress, amount),
        //     getLabel('To'),
        //     getAddressVisualization(receiver)
        //   ]
        //   return { ...call, fullVisualization }
        // },
        // [generalAdapterInterface.getFunction('wrapNative')?.selector!]: (
        //   call: IrCall
        // ): IrCall | undefined => {
        //   const { amount } = generalAdapterInterface.parseTransaction(call)!.args
        //   const fullVisualization = [getBreak(), ...getWrapping(ZeroAddress, amount)]
        //   return { ...call, fullVisualization }
        // },
        // [generalAdapterInterface.getFunction('unwrapNative')?.selector!]: (
        //   call: IrCall
        // ): IrCall | undefined => {
        //   const { amount } = generalAdapterInterface.parseTransaction(call)!.args
        //   const fullVisualization = [getBreak(), ...getUnwrapping(ZeroAddress, amount)]
        //   return { ...call, fullVisualization }
        // },
        // [generalAdapterInterface.getFunction('permit2TransferFrom')?.selector!]: (
        //     call: IrCall
        //   ): IrCall | undefined => {
        //     const { token, receiver, amount } = generalAdapterInterface.parseTransaction(call)!.args
        //     const fullVisualization = [
        //       getBreak(),
        //       getAction('Transfer'),
        //       getToken(token, amount),
        //       getLabel('To'),
        //       getAddressVisualization(receiver)
        //     ]
        //     return { ...call, fullVisualization }
        //   },
        [generalAdapterInterface.getFunction('morphoSupplyCollateral')?.selector]: (call) => {
            const { marketParams, assets, onBehalf, data } = generalAdapterInterface.parseTransaction(call).args;
            const collateral = marketParams[1];
            const collateralAmount = assets;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Supply'),
                (0, utils_1.getToken)(collateral, collateralAmount)
            ];
            return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) };
        },
        [generalAdapterInterface.getFunction('morphoBorrow')?.selector]: (call) => {
            const { marketParams, assets, shares, minSharePriceE27, receiver } = generalAdapterInterface.parseTransaction(call).args;
            const loanToken = marketParams[0];
            const loanAmount = assets;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Take'),
                (0, utils_1.getToken)(loanToken, loanAmount),
                (0, utils_1.getLabel)('loan')
            ];
            return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) };
        },
        [generalAdapterInterface.getFunction('morphoRepay')?.selector]: (call) => {
            const { marketParams, assets, shares, minSharePriceE27, onBehalf, data } = generalAdapterInterface.parseTransaction(call).args;
            const loanToken = marketParams[0];
            const loanAmount = assets;
            const fullVisualization = [(0, utils_1.getBreak)(), (0, utils_1.getAction)('Repay'), (0, utils_1.getToken)(loanToken, loanAmount)];
            return { ...call, fullVisualization, warnings: getWarnings(accAddr, onBehalf) };
        },
        [generalAdapterInterface.getFunction('morphoWithdrawCollateral')?.selector]: (call) => {
            const { marketParams, assets, receiver } = generalAdapterInterface.parseTransaction(call).args;
            const collateralToken = marketParams[1];
            const amount = assets;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Withdraw'),
                (0, utils_1.getToken)(collateralToken, amount)
            ];
            return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) };
        },
        [generalAdapterInterface.getFunction('morphoFlashLoan')?.selector]: (call) => {
            const { token, assets, data } = generalAdapterInterface.parseTransaction(call).args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Execute flash loan for'),
                (0, utils_1.getToken)(token, assets)
            ];
            return { ...call, fullVisualization };
        },
        [generalAdapterInterface.getFunction('erc4626Mint')?.selector]: (call) => {
            const { vault, assets, maxSharePriceE27, receiver } = generalAdapterInterface.parseTransaction(call).args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Supply to vault'),
                (0, utils_1.getAddressVisualization)(vault)
            ];
            return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) };
        },
        [generalAdapterInterface.getFunction('erc4626Deposit')?.selector]: (call) => {
            const { vault, assets, maxSharePriceE27, receiver } = generalAdapterInterface.parseTransaction(call).args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Mint from vault'),
                (0, utils_1.getAddressVisualization)(vault)
            ];
            return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) };
        },
        [generalAdapterInterface.getFunction('erc4626Withdraw')?.selector]: (call) => {
            const { vault, assets, maxSharePriceE27, receiver, owner } = generalAdapterInterface.parseTransaction(call).args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Withdraw from vault'),
                (0, utils_1.getAddressVisualization)(vault)
            ];
            return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) };
        },
        [generalAdapterInterface.getFunction('erc4626Redeem')?.selector]: (call) => {
            const { vault, assets, maxSharePriceE27, receiver, owner } = generalAdapterInterface.parseTransaction(call).args;
            const fullVisualization = [
                (0, utils_1.getBreak)(),
                (0, utils_1.getAction)('Withdraw from vault'),
                (0, utils_1.getAddressVisualization)(vault)
            ];
            return { ...call, fullVisualization, warnings: getWarnings(accAddr, receiver) };
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
const Bundler3Module = (accOp, calls) => {
    const matcher = {
        [iface.getFunction('multicall')?.selector]: (call) => {
            if (!call.to)
                return;
            if (call.value)
                return;
            const { bundle } = iface.parseTransaction(call).args;
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
    const newCalls = calls.map((call) => {
        const match = matcher[call.data.slice(0, 10)];
        if (call.fullVisualization || !match)
            return call;
        const newCall = match(call);
        if (!newCall)
            return call;
        return newCall;
    });
    return newCalls;
};
exports.default = Bundler3Module;
//# sourceMappingURL=index.js.map