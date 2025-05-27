// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

struct OutcomeAddress {
    address addr;
    bool success;
    bytes err;
}

struct OutcomeString {
    string str;
    bool success;
    bytes err;
}

struct OutcomeUint8 {
    uint8 number;
    bool success;
    bytes err;
}

struct UserAccountData {
    uint256 totalCollateralBase;
    uint256 totalDebtBase;
    uint256 availableBorrowsBase;
    uint256 currentLiquidationThreshold;
    uint256 ltv;
    uint256 healthFactor;
}

struct AAVEInfo {
    address poolAddr;
    address underlyingAsset;
}

struct ReserveConfigurationMap {
    //bit 0-15: LTV
    //bit 16-31: Liq. threshold
    //bit 32-47: Liq. bonus
    //bit 48-55: Decimals
    //bit 56: reserve is active
    //bit 57: reserve is frozen
    //bit 58: borrowing is enabled
    //bit 59: stable rate borrowing enabled
    //bit 60: asset is paused
    //bit 61: borrowing in isolation mode is enabled
    //bit 62: siloed borrowing enabled
    //bit 63: flashloaning enabled
    //bit 64-79: reserve factor
    //bit 80-115 borrow cap in whole tokens, borrowCap == 0 => no cap
    //bit 116-151 supply cap in whole tokens, supplyCap == 0 => no cap
    //bit 152-167 liquidation protocol fee
    //bit 168-175 eMode category
    //bit 176-211 unbacked mint cap in whole tokens, unbackedMintCap == 0 => minting disabled
    //bit 212-251 debt ceiling for isolation mode with (ReserveConfiguration::DEBT_CEILING_DECIMALS) decimals
    //bit 252-255 unused

    uint256 data;
}

struct ReserveData {
    //stores the reserve configuration
    ReserveConfigurationMap configuration;
    //the liquidity index. Expressed in ray
    uint128 liquidityIndex;
    //the current supply rate. Expressed in ray
    uint128 currentLiquidityRate;
    //variable borrow index. Expressed in ray
    uint128 variableBorrowIndex;
    //the current variable borrow rate. Expressed in ray
    uint128 currentVariableBorrowRate;
    //the current stable borrow rate. Expressed in ray
    uint128 currentStableBorrowRate;
    //timestamp of last update
    uint40 lastUpdateTimestamp;
    //the id of the reserve. Represents the position in the list of the active reserves
    uint16 id;
    //aToken address
    address aTokenAddress;
    //stableDebtToken address
    address stableDebtTokenAddress;
    //variableDebtToken address
    address variableDebtTokenAddress;
    //address of the interest rate strategy
    address interestRateStrategyAddress;
    //the current treasury balance, scaled
    uint128 accruedToTreasury;
    //the outstanding unbacked aTokens minted through the bridging feature
    uint128 unbacked;
    //the outstanding debt borrowed against this asset in isolation mode
    uint128 isolationModeTotalDebt;
}

struct ReserveDataIronclad {
  ReserveConfigurationMap configuration;
  uint128 liquidityIndex;
  uint128 variableBorrowIndex;
  uint128 currentLiquidityRate; 
  uint128 currentVariableBorrowRate;
  uint128 currentStableBorrowRate;
  uint40 lastUpdateTimestamp;
  address aTokenAddress;
  address stableDebtTokenAddress;
  address variableDebtTokenAddress;
  address interestRateStrategyAddress;
  uint8 id;
}

struct TokenFromBalance {
    address addr;
    string symbol;
    string name;
    uint256 balance;
    uint8 decimals;
    uint256 price;
    uint256 borrowAssetBalance;
    uint256 stableBorrowAssetBalance;
    uint128 currentLiquidityRate;
    uint128 currentVariableBorrowRate;
    uint128 currentStableBorrowRate;
    
    address aaveAddr;
    string aaveSymbol;
    string aaveName;
    uint8 aaveDecimals;
    
    address aaveSDebtAddr;
    string aaveSDebtSymbol;
    string aaveSDebtName;
    uint8 aaveSDebtDecimals;
    
    address aaveVDebtAddr;
    string aaveVDebtSymbol;
    string aaveVDebtName;
    uint8 aaveVDebtDecimals;
    
}

struct AAVEUserBalance {
    TokenFromBalance[] userBalance;
    UserAccountData accountData;
    bytes userBalanceErr;
    bytes accountDataErr;

}

interface IPoolAddressesProvider {
   function getPriceOracle() external view returns (address);
}

interface IAaveOracle {
   function getAssetPrice(address asset) external view returns (uint256);
}

interface IATOKEN {
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
    function name() external view returns (string memory);
    function POOL() external view returns (address);
    function scaledBalanceOf(address) external view returns (uint256);
    function scaledTotalSupply() external view returns (uint256);
    function nonces(address) external view returns (uint256);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

interface IPOOL {
    // optimism (0x794a61358D6845594F94dc1DB02A252b5b4814aD)
    // mainnet (0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2)
    function ADDRESSES_PROVIDER() external view returns (address);
    function getAddressesProvider() external view returns (address);
    function getBorrowLogic() external view returns (address);
    function getPoolLogic() external view returns (address);
    function getReservesList() external view returns (address[] memory);
    function getReserveData(address reserveAddr) external view returns (ReserveData memory);
    function getUserAccountData(address userAddress) external view returns (UserAccountData memory);
}

interface IPOOLIronclad {
    // optimism (0x794a61358D6845594F94dc1DB02A252b5b4814aD)
    // mainnet (0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2)
    function ADDRESSES_PROVIDER() external view returns (address);
    function getAddressesProvider() external view returns (address);
    function getBorrowLogic() external view returns (address);
    function getPoolLogic() external view returns (address);
    function getReservesList() external view returns (address[] memory);
    function getReserveData(address reserveAddr) external view returns (ReserveDataIronclad memory);
    function getUserAccountData(address userAddress) external view returns (UserAccountData memory);
}


contract CALLS {
    function ADDRESSES_PROVIDER(address poolAddress) external view returns (address) {
        return IPOOL(poolAddress).ADDRESSES_PROVIDER();
    }

    function getAddressesProvider(address poolAddress) external view returns (address) {
        return IPOOL(poolAddress).getAddressesProvider();
    }

    function getTokenSymbol(address tokenAddr) external view returns (string memory) {
        return IATOKEN(tokenAddr).symbol();
    }
    function getTokenName(address tokenAddr) external view returns (string memory) {
        return IATOKEN(tokenAddr).name();
    }

    function getTokenDecimals(address tokenAddr) external view returns (uint8) {
        return IATOKEN(tokenAddr).decimals();
    }
}


contract AAVEPosition {
    CALLS calls = new CALLS();
    function ADDRESSES_PROVIDER(address poolAddress) internal view returns (OutcomeAddress memory outcome) {
        try calls.ADDRESSES_PROVIDER(poolAddress) returns (address result) {
            outcome.addr = result;
            outcome.success = true;
        } catch (bytes memory err) {
            outcome.err = err;
            outcome.success = false;
        }
    }

    function getAddressesProvider(address poolAddress) internal view returns (OutcomeAddress memory outcome) {
        try calls.getAddressesProvider(poolAddress) returns (address result) {
            outcome.addr = result;
            outcome.success = true;
        } catch (bytes memory err) {
            outcome.err = err;
            outcome.success = false;
        }
    }

    function getTokenSymbolTry(address tokenAddr) internal view returns (OutcomeString memory outcome) {
        try calls.getTokenSymbol(tokenAddr) returns (string memory result) {
            outcome.str = result;
            outcome.success = true;
        } catch (bytes memory err) {
            outcome.err = err;
            outcome.success = false;
        }
    }

    function getTokenNameTry(address tokenAddr) internal view returns (OutcomeString memory outcome) {
        try calls.getTokenName(tokenAddr) returns (string memory result) {
            outcome.str = result;
            outcome.success = true;
        } catch (bytes memory err) {
            outcome.err = err;
            outcome.success = false;
        }
    }

    function getTokenSymbol(address baseAddr) internal view returns (string memory outcome) {
        OutcomeString memory result = getTokenSymbolTry(baseAddr);
        if (result.success) {
            outcome = result.str;
        } else {
            outcome = 'error';
        }
    }
    
    function getTokenName(address baseAddr) internal view returns (string memory outcome) {
        OutcomeString memory result = getTokenNameTry(baseAddr);
        if (result.success) {
            outcome = result.str;
        } else {
            outcome = 'error';
        }
    }

    function getTokenDecimalsTry(address tokenAddr) internal view returns (OutcomeUint8 memory outcome) {
        try calls.getTokenDecimals(tokenAddr) returns (uint8 result) {
            outcome.number = result;
            outcome.success = true;
        } catch (bytes memory err) {
            outcome.err = err;
            outcome.success = false;
        }
    }

    function getTokenDecimals(address baseAddr) internal view returns (uint8 outcome) {
        OutcomeUint8 memory result = getTokenDecimalsTry(baseAddr);
        if (result.success) {
            outcome = result.number;
        } else {
            outcome = 19;
        }
    }

    function getTokenBalancesFromPool(address userAddr, address poolAddress, uint from, uint to) external view returns (TokenFromBalance[] memory, bytes memory err) {
        bool standartAAVE = true;
        bool isError = false;
        address[] memory reserves = IPOOL(poolAddress).getReservesList();
        
        address provider;
        OutcomeAddress memory providerOutcome = ADDRESSES_PROVIDER(poolAddress);
        if (providerOutcome.success == false) {
            providerOutcome = getAddressesProvider(poolAddress);
            if (providerOutcome.success) {
                provider = providerOutcome.addr;
            } else {
                err = providerOutcome.err;
                isError = true;
            }
            standartAAVE = false;
        } else {
            provider = providerOutcome.addr;
        }

        uint reservesLen = reserves.length;

        if (from > reservesLen) {
            return (new TokenFromBalance[](0), err);
        }

        uint actTo = to;

        if (to > reservesLen) {
            actTo = reservesLen;
        }

        TokenFromBalance[] memory userBalance = new TokenFromBalance[](actTo - from);
        
        if (isError) {
            return (userBalance, err);
        }

        address priceOralceAddr = IPoolAddressesProvider(provider).getPriceOracle();
        uint pos = 0;
        for (uint i = from; i < actTo; i++) {
            if (standartAAVE) {
                ReserveData memory reserveData = IPOOL(poolAddress).getReserveData(reserves[i]);    
                uint256 price = IAaveOracle(priceOralceAddr).getAssetPrice(reserves[i]);
                TokenFromBalance memory aToken;
                aToken.addr = reserves[i];
                aToken.balance = IATOKEN(reserveData.aTokenAddress).balanceOf(userAddr);
                aToken.symbol = getTokenSymbol(reserves[i]);
                aToken.name = getTokenName(reserves[i]);
                aToken.decimals = IATOKEN(reserves[i]).decimals();
                aToken.price = price;
                aToken.borrowAssetBalance = IATOKEN(reserveData.variableDebtTokenAddress).balanceOf(userAddr);
                aToken.stableBorrowAssetBalance = IATOKEN(reserveData.stableDebtTokenAddress).balanceOf(userAddr);
                aToken.currentLiquidityRate = reserveData.currentLiquidityRate;
                aToken.currentVariableBorrowRate = reserveData.currentVariableBorrowRate;
                aToken.currentStableBorrowRate = reserveData.currentStableBorrowRate;
                
                aToken.aaveAddr = reserveData.aTokenAddress;
                aToken.aaveSymbol = getTokenSymbol(reserveData.aTokenAddress);
                aToken.aaveName = getTokenName(reserveData.aTokenAddress);
                aToken.aaveDecimals = getTokenDecimals(reserveData.aTokenAddress);

                aToken.aaveSDebtAddr = reserveData.stableDebtTokenAddress;
                aToken.aaveSDebtSymbol = getTokenSymbol(reserveData.stableDebtTokenAddress);
                aToken.aaveSDebtName = getTokenName(reserveData.stableDebtTokenAddress);
                aToken.aaveSDebtDecimals = getTokenDecimals(reserveData.stableDebtTokenAddress);

                aToken.aaveVDebtAddr = reserveData.variableDebtTokenAddress;
                aToken.aaveVDebtSymbol = getTokenSymbol(reserveData.variableDebtTokenAddress);
                aToken.aaveVDebtName = getTokenName(reserveData.variableDebtTokenAddress);
                aToken.aaveVDebtDecimals = getTokenDecimals(reserveData.variableDebtTokenAddress);

                userBalance[pos] = aToken;
                
            } else {
                ReserveDataIronclad memory reserveData = IPOOLIronclad(poolAddress).getReserveData(reserves[i]);    
                uint256 price = IAaveOracle(priceOralceAddr).getAssetPrice(reserves[i]);
                TokenFromBalance memory aToken;
                aToken.addr = reserves[i];
                aToken.balance = IATOKEN(reserveData.aTokenAddress).balanceOf(userAddr);
                aToken.symbol = getTokenSymbol(reserves[i]);
                aToken.name = getTokenName(reserves[i]);
                aToken.decimals = IATOKEN(reserveData.aTokenAddress).decimals();
                aToken.price = price;
                aToken.borrowAssetBalance = IATOKEN(reserveData.variableDebtTokenAddress).balanceOf(userAddr);
                aToken.stableBorrowAssetBalance = IATOKEN(reserveData.stableDebtTokenAddress).balanceOf(userAddr);
                aToken.currentLiquidityRate = reserveData.currentLiquidityRate;
                aToken.currentVariableBorrowRate = reserveData.currentVariableBorrowRate;
                aToken.currentStableBorrowRate = reserveData.currentStableBorrowRate;
                
                aToken.aaveAddr = reserveData.aTokenAddress;
                aToken.aaveSymbol = getTokenSymbol(reserveData.aTokenAddress);
                aToken.aaveName = getTokenName(reserveData.aTokenAddress);
                aToken.aaveDecimals = getTokenDecimals(reserveData.aTokenAddress);

                aToken.aaveSDebtAddr = reserveData.stableDebtTokenAddress;
                aToken.aaveSDebtSymbol = getTokenSymbol(reserveData.stableDebtTokenAddress);
                aToken.aaveSDebtName = getTokenName(reserveData.stableDebtTokenAddress);
                aToken.aaveSDebtDecimals = getTokenDecimals(reserveData.stableDebtTokenAddress);

                aToken.aaveVDebtAddr = reserveData.variableDebtTokenAddress;
                aToken.aaveVDebtSymbol = getTokenSymbol(reserveData.variableDebtTokenAddress);
                aToken.aaveVDebtName = getTokenName(reserveData.variableDebtTokenAddress);
                aToken.aaveVDebtDecimals = getTokenDecimals(reserveData.variableDebtTokenAddress);

                userBalance[pos] = aToken;
            }
            pos++;
        }
        return (userBalance, err);
    }

    function getUserAccountData(address userAddr, address poolAddress) external view returns (UserAccountData memory result, bytes memory err) {
            return (IPOOL(poolAddress).getUserAccountData((userAddr)), err);
    }
}


contract DeFiAAVEPosition {
    AAVEPosition positions = new AAVEPosition();
    function getAAVEPosition(address userAddr, address poolAddr, uint from, uint to) external view returns (AAVEUserBalance memory result) {
        (result.userBalance, result.accountDataErr) = positions.getTokenBalancesFromPool(userAddr, poolAddr, from, to);
        (result.accountData, result.accountDataErr) = positions.getUserAccountData(userAddr, poolAddr);
        return result;
    }
}