"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeFiPositionsError = exports.AssetType = void 0;
// @TODO: Move these interfaces to src/interfaces and
// figure out how to restructure portfolio/defiPositions types
var AssetType;
(function (AssetType) {
    AssetType[AssetType["Liquidity"] = 0] = "Liquidity";
    AssetType[AssetType["Collateral"] = 1] = "Collateral";
    AssetType[AssetType["Borrow"] = 2] = "Borrow";
    AssetType[AssetType["Reward"] = 3] = "Reward";
    AssetType[AssetType["Margin"] = 4] = "Margin";
    AssetType[AssetType["Perpetual"] = 5] = "Perpetual";
    AssetType[AssetType["Prediction"] = 6] = "Prediction";
})(AssetType || (exports.AssetType = AssetType = {}));
var DeFiPositionsError;
(function (DeFiPositionsError) {
    DeFiPositionsError["AssetPriceError"] = "AssetPriceError";
    DeFiPositionsError["CriticalError"] = "CriticalError";
})(DeFiPositionsError || (exports.DeFiPositionsError = DeFiPositionsError = {}));
//# sourceMappingURL=types.js.map