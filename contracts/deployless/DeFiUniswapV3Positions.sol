// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

struct Position {
    uint96 nonce;
    address operator;
    address token0;
    address token1;
    uint24 fee;
    int24 tickLower;
    int24 tickUpper;
    uint128 liquidity;
    uint256 feeGrowthInside0LastX128;
    uint256 feeGrowthInside1LastX128;
    uint128 tokensOwed0;
    uint128 tokensOwed1;   
}

struct PoolSlot0 {
    uint160 sqrtPriceX96;
    int24 tick;
    uint16 observationIndex;
    uint16 observationCardinality;
    uint16 observationCardinalityNext;
    uint8 feeProtocol;
    bool unlocked;
}

struct TickData {
    uint128 liquidityGross;
    int128 liquidityNet;
    uint256 feeGrowthOutside0X128;
    uint256 feeGrowthOutside1X128;
    int56 tickCumulativeOutside;
    uint160 secondsPerLiquidityOutsideX128;
    uint32 secondsOutside;
    bool initialized;
}

interface IUniswapV3Pool {
    function feeGrowthGlobal0X128() external view returns (uint256);
    function ticks(int24) external view returns (TickData memory);
    function factory() external view returns (address);
    function slot0() external view returns (PoolSlot0 memory);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface INonfungiblePositionManager {
    function positions(uint256 tokenId) external view returns (Position memory);
    function balanceOf(address) external view returns (uint256);
    function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IERC20 {
    function symbol() external view returns (string memory);
    function name() external view returns (string memory);
    function decimals() external view returns (uint8);
}

struct UniV3PositionsData {
    string token0Symbol;
    string token0Name;
    uint8 token0Decimals;
    string token1Symbol;
    string token1Name;
    uint8 token1Decimals;
    Position positionInfo;
    PoolSlot0 poolSlot0;
    uint256 feeGrowthGlobal0X128;
    // TickData upperTickData;
    // TickData lowerTickData;
    uint256 positionId;
}

contract DeFiUniswapV3Positions {
    function getUniV3Position(address userAddr, address positionManagementAddr, address factoryAddr) external view returns (UniV3PositionsData[] memory result) {
        uint256 tokensAmount = INonfungiblePositionManager(positionManagementAddr).balanceOf(userAddr);

        uint256 numberOfPositionsToReturn = 0;
        for (uint256 i = 0; i < tokensAmount; i++) {
            uint256 tokenId = INonfungiblePositionManager(positionManagementAddr).tokenOfOwnerByIndex(userAddr, i);            
            Position memory positionInfo = INonfungiblePositionManager(positionManagementAddr).positions(tokenId);
            if(positionInfo.liquidity != 0) numberOfPositionsToReturn++;
            
        }
        UniV3PositionsData[] memory positions = new UniV3PositionsData[](numberOfPositionsToReturn);

        uint256 returnArrayIndex = 0;
        for (uint256 i = 0; i < tokensAmount; i++) {
            uint256 tokenId = INonfungiblePositionManager(positionManagementAddr).tokenOfOwnerByIndex(userAddr, i);            
            Position memory positionInfo = INonfungiblePositionManager(positionManagementAddr).positions(tokenId);
            
            if(positionInfo.liquidity == 0) continue;

            address poolAddr = IUniswapV3Factory(factoryAddr).getPool(positionInfo.token0, positionInfo.token1, positionInfo.fee);

            // outputData
            positions[returnArrayIndex].positionId = tokenId;
            positions[returnArrayIndex].positionInfo = positionInfo;
            positions[returnArrayIndex].poolSlot0 = IUniswapV3Pool(poolAddr).slot0();
            positions[returnArrayIndex].feeGrowthGlobal0X128 = IUniswapV3Pool(poolAddr).feeGrowthGlobal0X128();
            // positions[returnArrayIndex].upperTickData = IUniswapV3Pool(poolAddr).ticks(positionInfo.tickUpper);
            // positions[returnArrayIndex].lowerTickData = IUniswapV3Pool(poolAddr).ticks(positionInfo.tickLower);
            positions[returnArrayIndex].token0Symbol = IERC20(positionInfo.token0).symbol();
            positions[returnArrayIndex].token0Name = IERC20(positionInfo.token0).name();
            positions[returnArrayIndex].token1Name = IERC20(positionInfo.token1).name();
            positions[returnArrayIndex].token0Decimals = IERC20(positionInfo.token0).decimals();
            positions[returnArrayIndex].token1Symbol = IERC20(positionInfo.token1).symbol();
            positions[returnArrayIndex].token1Decimals = IERC20(positionInfo.token1).decimals();
            returnArrayIndex++;
        }
        return positions;

    }
}