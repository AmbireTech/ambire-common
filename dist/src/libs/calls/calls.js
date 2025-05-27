"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFeeCall = getFeeCall;
exports.decodeFeeCall = decodeFeeCall;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const addresses_1 = require("../../consts/addresses");
const deploy_1 = require("../../consts/deploy");
const gasTankFeeTokens_1 = tslib_1.__importDefault(require("../../consts/gasTankFeeTokens"));
const abiCoder = new ethers_1.AbiCoder();
const ERC20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
function getFeeCall(feeToken) {
    // set a bigger number for gas tank / approvals so on
    // L2s it could calculate the preVerificationGas better
    const gasTankOrApproveAmount = 500n * BigInt(feeToken.decimals);
    if (feeToken.flags.onGasTank) {
        return {
            to: addresses_1.FEE_COLLECTOR,
            value: 0n,
            data: abiCoder.encode(['string', 'uint256', 'string'], ['gasTank', gasTankOrApproveAmount, feeToken.symbol])
        };
    }
    if (feeToken.address === ethers_1.ZeroAddress) {
        // native payment
        return {
            to: addresses_1.FEE_COLLECTOR,
            value: 1n,
            data: '0x'
        };
    }
    // token payment
    return {
        to: feeToken.address,
        value: 0n,
        data: ERC20Interface.encodeFunctionData('approve', [
            deploy_1.DEPLOYLESS_SIMULATION_FROM,
            gasTankOrApproveAmount
        ])
    };
}
function decodeFeeCall({ to, value, data }, network) {
    if (to === addresses_1.FEE_COLLECTOR) {
        if (data === '0x') {
            return {
                address: ethers_1.ZeroAddress,
                amount: value,
                isGasTank: false,
                chainId: network.chainId
            };
        }
        const [, amount, symbol] = abiCoder.decode(['string', 'uint256', 'string'], data);
        // Prioritize Ethereum tokens
        const ethereumToken = gasTankFeeTokens_1.default.find(({ symbol: tSymbol, chainId: tChainId }) => tSymbol.toLowerCase() === symbol.toLowerCase() && tChainId === 1n);
        // Fallback to network tokens
        const networkToken = network.chainId !== 1n
            ? gasTankFeeTokens_1.default.find(({ symbol: tSymbol, chainId: tChainId }) => tSymbol.toLowerCase() === symbol.toLowerCase() && tChainId === network.chainId)
            : null;
        // Fallback to any network token. Example: user paid the fee on Base
        // with Wrapped Matic (neither Ethereum nor Base token)
        const anyNetworkToken = gasTankFeeTokens_1.default.find(({ symbol: tSymbol }) => tSymbol.toLowerCase() === symbol.toLowerCase());
        // This is done for backwards compatibility with the old gas tank. A known flaw
        // is that it may prioritize the wrong token. Example: a user had paid the fee with
        // USDT on BSC, but we prioritize the USDT on Ethereum. 18 vs 6 decimals.
        // There is no way to fix this as the call data doesn't contain the decimals nor
        // the network of the token.
        const { address, chainId } = ethereumToken || networkToken || anyNetworkToken || {};
        if (!address)
            throw new Error(`Unable to find gas tank fee token for symbol ${symbol} and network ${chainId}`);
        return {
            amount,
            address,
            isGasTank: true,
            chainId: chainId
        };
    }
    const [, amount] = ERC20Interface.decodeFunctionData('transfer', data);
    return {
        amount,
        address: to,
        isGasTank: false,
        chainId: network.chainId
    };
}
//# sourceMappingURL=calls.js.map