// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

// Reads an account's Aave v4 positions in the given spokes in a single call. Each spoke is a
// lending market with its own collateral, debt and health factor. It returns raw data only:
// the values are calculated off-chain, where they can be tested.

// Aave v4's `ISpoke.Reserve`
struct SpokeReserve {
    address underlying;
    address hub;
    uint16 assetId;
    uint8 decimals;
    uint24 collateralRisk;
    uint8 flags;
    uint32 dynamicConfigKey;
}

// Aave v4's `ISpoke.UserPosition`
struct SpokeUserPosition {
    uint120 drawnShares;
    uint120 premiumShares;
    int200 premiumOffsetRay;
    uint120 suppliedShares;
    uint32 dynamicConfigKey;
}

// Aave v4's `ISpoke.UserAccountData`
struct SpokeUserAccountData {
    uint256 riskPremium;
    uint256 avgCollateralFactor;
    // Scaled by 1e18. type(uint256).max when the account has no debt
    uint256 healthFactor;
    uint256 totalCollateralValue;
    uint256 totalDebtValueRay;
    uint256 activeCollateralCount;
    uint256 borrowCount;
}

struct ReservePosition {
    uint256 reserveId;
    address underlying;
    uint8 decimals;
    string symbol;
    string name;
    uint256 suppliedAssets;
    // The debt drawn and the premium on it
    uint256 debt;
    bool isUsingAsCollateral;
    // The USD price of 1 token, with the decimals of the spoke's oracle (`SpokePosition.priceDecimals`)
    uint256 price;
    bool hasPrice;
}

struct SpokePosition {
    address spoke;
    ReservePosition[] reserves;
    SpokeUserAccountData accountData;
    // False if the spoke couldn't calculate it (e.g. a price is missing)
    bool hasAccountData;
    uint8 priceDecimals;
    bool hasPriceDecimals;
}

interface ISpoke {
    function getReserveCount() external view returns (uint256);
    function getReserve(uint256 reserveId) external view returns (SpokeReserve memory);
    function getUserPosition(uint256 reserveId, address user)
        external
        view
        returns (SpokeUserPosition memory);
    function getUserSuppliedAssets(uint256 reserveId, address user) external view returns (uint256);
    function getUserTotalDebt(uint256 reserveId, address user) external view returns (uint256);
    // Whether the reserve is used as collateral and whether it's borrowed
    function getUserReserveStatus(uint256 reserveId, address user)
        external
        view
        returns (bool, bool);
    function getUserAccountData(address user) external view returns (SpokeUserAccountData memory);
    function ORACLE() external view returns (address);
}

interface IAaveV4Oracle {
    function decimals() external view returns (uint8);
    // Reverts if the price feed of the reserve returns a price that isn't above 0
    function getReservePrice(uint256 reserveId) external view returns (uint256);
}

contract DeFiAaveV4Positions {
    // Caps the gas of the calls to the tokens, so that a malicious one can't make the whole call
    // run out of gas
    uint256 constant TOKEN_CALL_GAS = 100_000;

    // Called through `this`, so that a failed decoding reverts in a call the caller can catch
    // with try/catch. Some tokens (e.g. MKR) return their symbol and name as bytes32
    function readString(address target, bytes4 selector) external view returns (string memory) {
        (bool success, bytes memory data) = target.staticcall(abi.encodeWithSelector(selector));
        require(success, 'call failed');

        if (data.length == 32) {
            bytes32 raw = abi.decode(data, (bytes32));
            uint256 length = 0;
            while (length < 32 && raw[length] != 0) length++;

            bytes memory result = new bytes(length);
            for (uint256 i = 0; i < length; i++) result[i] = raw[i];
            return string(result);
        }

        return abi.decode(data, (string));
    }

    // Returns only the spokes in which the user has a position. A spoke that fails to read fails
    // the whole call, as leaving it out would look like the user has no position there
    function getAaveV4Positions(address user, ISpoke[] calldata spokes)
        external
        view
        returns (SpokePosition[] memory positions)
    {
        SpokePosition[] memory spokePositions = new SpokePosition[](spokes.length);
        uint256 count = 0;

        for (uint256 i = 0; i < spokes.length; i++) {
            SpokePosition memory spokePosition = getSpokePosition(user, spokes[i]);
            if (spokePosition.reserves.length == 0) continue;

            spokePositions[count] = spokePosition;
            count++;
        }

        positions = new SpokePosition[](count);
        for (uint256 i = 0; i < count; i++) positions[i] = spokePositions[i];
    }

    // The reserves with a position are found first and only then read in full, as most accounts
    // have a position in a few reserves, if any
    function getSpokePosition(address user, ISpoke spoke)
        internal
        view
        returns (SpokePosition memory position)
    {
        position.spoke = address(spoke);

        uint256 reserveCount = spoke.getReserveCount();
        uint256[] memory reserveIdsWithPosition = new uint256[](reserveCount);
        uint256 count = 0;

        for (uint256 reserveId = 0; reserveId < reserveCount; reserveId++) {
            SpokeUserPosition memory userPosition = spoke.getUserPosition(reserveId, user);
            bool hasPosition = userPosition.suppliedShares > 0 ||
                userPosition.drawnShares > 0 ||
                userPosition.premiumShares > 0;
            if (!hasPosition) continue;

            reserveIdsWithPosition[count] = reserveId;
            count++;
        }

        if (count == 0) return position;

        IAaveV4Oracle oracle = IAaveV4Oracle(spoke.ORACLE());
        try oracle.decimals() returns (uint8 decimals) {
            position.priceDecimals = decimals;
            position.hasPriceDecimals = true;
        } catch {}

        position.reserves = new ReservePosition[](count);
        for (uint256 i = 0; i < count; i++) {
            position.reserves[i] = getReservePosition(user, spoke, oracle, reserveIdsWithPosition[i]);
        }

        try spoke.getUserAccountData(user) returns (SpokeUserAccountData memory accountData) {
            position.accountData = accountData;
            position.hasAccountData = true;
        } catch {}
    }

    function getReservePosition(
        address user,
        ISpoke spoke,
        IAaveV4Oracle oracle,
        uint256 reserveId
    ) internal view returns (ReservePosition memory position) {
        SpokeReserve memory reserve = spoke.getReserve(reserveId);

        position.reserveId = reserveId;
        position.underlying = reserve.underlying;
        position.decimals = reserve.decimals;
        position.suppliedAssets = spoke.getUserSuppliedAssets(reserveId, user);
        position.debt = spoke.getUserTotalDebt(reserveId, user);
        (position.isUsingAsCollateral, ) = spoke.getUserReserveStatus(reserveId, user);

        try this.readString{gas: TOKEN_CALL_GAS}(reserve.underlying, bytes4(keccak256('symbol()')))
        returns (string memory symbol) {
            position.symbol = symbol;
        } catch {}

        try this.readString{gas: TOKEN_CALL_GAS}(reserve.underlying, bytes4(keccak256('name()')))
        returns (string memory name) {
            position.name = name;
        } catch {}

        try oracle.getReservePrice(reserveId) returns (uint256 price) {
            position.price = price;
            position.hasPrice = true;
        } catch {}
    }
}
