"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeFiPositionsError = exports.AssetType = void 0;
var AssetType;
(function (AssetType) {
    AssetType[AssetType["Liquidity"] = 0] = "Liquidity";
    AssetType[AssetType["Collateral"] = 1] = "Collateral";
    AssetType[AssetType["Borrow"] = 2] = "Borrow";
})(AssetType = exports.AssetType || (exports.AssetType = {}));
var DeFiPositionsError;
(function (DeFiPositionsError) {
    DeFiPositionsError["AssetPriceError"] = "AssetPriceError";
    DeFiPositionsError["CriticalError"] = "CriticalError";
})(DeFiPositionsError = exports.DeFiPositionsError || (exports.DeFiPositionsError = {}));
//# sourceMappingURL=types.js.map