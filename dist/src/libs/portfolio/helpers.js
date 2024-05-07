"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldGetAdditionalPortfolio = exports.getFlags = void 0;
const feeTokens_1 = __importDefault(require("../../consts/feeTokens"));
const gasTankFeeTokens_1 = __importDefault(require("../../consts/gasTankFeeTokens"));
function getFlags(networkData, networkId, tokenNetwork, address) {
    const onGasTank = networkId === 'gasTank';
    let rewardsType = null;
    if (networkData?.xWalletClaimableBalance?.address === address)
        rewardsType = 'wallet-vesting';
    if (networkData?.walletClaimableBalance?.address === address)
        rewardsType = 'wallet-rewards';
    const canTopUpGasTank = gasTankFeeTokens_1.default.some((t) => t.address === address &&
        (onGasTank || networkId === 'rewards'
            ? t.networkId === tokenNetwork
            : t.networkId === networkId));
    const isFeeToken = feeTokens_1.default.some((t) => t.address === address &&
        (onGasTank || networkId === 'rewards'
            ? t.networkId === tokenNetwork
            : t.networkId === networkId));
    return {
        onGasTank,
        rewardsType,
        canTopUpGasTank,
        isFeeToken
    };
}
exports.getFlags = getFlags;
const shouldGetAdditionalPortfolio = (account) => {
    // portfolio additional data is available only for smart accounts
    return !!account?.creation;
};
exports.shouldGetAdditionalPortfolio = shouldGetAdditionalPortfolio;
//# sourceMappingURL=helpers.js.map