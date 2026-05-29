// @TODO: Move these interfaces to src/interfaces and
// figure out how to restructure portfolio/defiPositions types
export var AssetType;
(function (AssetType) {
    AssetType[AssetType["Liquidity"] = 0] = "Liquidity";
    AssetType[AssetType["Collateral"] = 1] = "Collateral";
    AssetType[AssetType["Borrow"] = 2] = "Borrow";
    AssetType[AssetType["Reward"] = 3] = "Reward";
})(AssetType || (AssetType = {}));
export var DeFiPositionsError;
(function (DeFiPositionsError) {
    DeFiPositionsError["AssetPriceError"] = "AssetPriceError";
    DeFiPositionsError["CriticalError"] = "CriticalError";
})(DeFiPositionsError || (DeFiPositionsError = {}));
//# sourceMappingURL=types.js.map