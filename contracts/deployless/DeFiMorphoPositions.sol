// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

// Reads an account's Morpho positions - lending markets (Morpho Blue) and vaults (MetaMorpho
// and Vault V2) - in a single call. It returns raw data only: converting shares to amounts,
// accruing interest and the health rate are calculated off-chain, where they can be tested.

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

struct Market {
    uint128 totalSupplyAssets;
    uint128 totalSupplyShares;
    uint128 totalBorrowAssets;
    uint128 totalBorrowShares;
    uint128 lastUpdate;
    uint128 fee;
}

struct TokenInfo {
    string symbol;
    string name;
    uint8 decimals;
    // False if the token didn't return its decimals; its amounts can't be displayed then
    bool hasDecimals;
}

struct MarketPosition {
    bytes32 id;
    MarketParams params;
    Market market;
    uint256 supplyShares;
    uint256 borrowShares;
    uint256 collateral;
    // The current borrow rate per second, scaled by 1e18. Used to accrue the interest since
    // the market was last updated, as `market` holds the totals as of `lastUpdate`
    uint256 borrowRate;
    bool hasBorrowRate;
    // The price of 1 collateral token in loan tokens, scaled by 1e36 (see Morpho's IOracle)
    uint256 oraclePrice;
    bool hasOraclePrice;
    TokenInfo loanToken;
    TokenInfo collateralToken;
}

struct VaultPosition {
    address vault;
    uint256 shares;
    uint256 assets;
    bool hasAssets;
    TokenInfo vaultToken;
    address asset;
    TokenInfo assetToken;
}

struct MorphoPositions {
    uint256 blockTimestamp;
    MarketPosition[] markets;
    VaultPosition[] vaults;
}

interface IMorpho {
    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);
    function market(bytes32 id) external view returns (Market memory);
    function idToMarketParams(bytes32 id) external view returns (MarketParams memory);
}

interface IIrm {
    function borrowRateView(MarketParams memory marketParams, Market memory market)
        external
        view
        returns (uint256);
}

interface IOracle {
    function price() external view returns (uint256);
}

interface IMetaMorphoFactory {
    function isMetaMorpho(address target) external view returns (bool);
}

interface IVaultV2Factory {
    function isVaultV2(address target) external view returns (bool);
}

interface IERC4626 {
    function balanceOf(address account) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function asset() external view returns (address);
}

contract DeFiMorphoPositions {
    // Caps the gas of the calls to contracts we don't trust (tokens, oracles, interest rate models),
    // so that a malicious one can't make the whole call run out of gas
    uint256 constant TOKEN_CALL_GAS = 100_000;
    uint256 constant PRICE_CALL_GAS = 1_000_000;

    // Calls that may revert or return malformed data. They are external and called through `this`,
    // so that a failed decoding reverts in a call the caller can catch with try/catch.
    // Not in a separate contract created in the constructor, as the constructor doesn't run
    // when the RPC supports state override: the code is set at an address, without any storage

    // Some tokens (e.g. MKR) return their symbol and name as bytes32
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

    function readDecimals(address target) external view returns (uint8) {
        (bool success, bytes memory data) = target.staticcall(abi.encodeWithSignature('decimals()'));
        require(success && data.length >= 32, 'call failed');

        uint256 decimals = abi.decode(data, (uint256));
        require(decimals <= type(uint8).max, 'invalid decimals');
        return uint8(decimals);
    }

    // Anyone can create a market, with any contract (or none) as its oracle and interest rate model
    function readUint(address target, bytes calldata callData) external view returns (uint256) {
        (bool success, bytes memory data) = target.staticcall(callData);
        require(success && data.length >= 32, 'call failed');

        return abi.decode(data, (uint256));
    }

    function getMorphoPositions(
        address user,
        IMorpho morpho,
        bytes32[] calldata marketIds,
        address[] calldata metaMorphoFactories,
        address[] calldata vaultV2Factories,
        address[] calldata vaultCandidates
    ) external view returns (MorphoPositions memory result) {
        result.blockTimestamp = block.timestamp;
        result.markets = getMarketPositions(user, morpho, marketIds);
        result.vaults = getVaultPositions(user, metaMorphoFactories, vaultV2Factories, vaultCandidates);
    }

    // Returns only the markets in which the user has a position. Hundreds of markets are checked,
    // so the positions are found first and only then allocated, as a memory array of structs
    // is zero-filled on allocation, and memory costs grow quadratically
    function getMarketPositions(address user, IMorpho morpho, bytes32[] calldata marketIds)
        internal
        view
        returns (MarketPosition[] memory positions)
    {
        uint256[] memory indexesWithPosition = new uint256[](marketIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < marketIds.length; i++) {
            (uint256 supplyShares, uint128 borrowShares, uint128 collateral) = morpho.position(marketIds[i], user);
            if (supplyShares == 0 && borrowShares == 0 && collateral == 0) continue;

            indexesWithPosition[count] = i;
            count++;
        }

        positions = new MarketPosition[](count);
        for (uint256 i = 0; i < count; i++) {
            positions[i] = getMarketPosition(morpho, marketIds[indexesWithPosition[i]], user);
        }
    }

    function getMarketPosition(IMorpho morpho, bytes32 id, address user)
        internal
        view
        returns (MarketPosition memory position)
    {
        position.id = id;
        position.params = morpho.idToMarketParams(id);
        position.market = morpho.market(id);
        (position.supplyShares, position.borrowShares, position.collateral) = morpho.position(id, user);

        if (position.params.irm != address(0)) {
            try this.readUint{gas: PRICE_CALL_GAS}(
                position.params.irm,
                abi.encodeCall(IIrm.borrowRateView, (position.params, position.market))
            ) returns (uint256 borrowRate) {
                position.borrowRate = borrowRate;
                position.hasBorrowRate = true;
            } catch {}
        }

        if (position.params.oracle != address(0)) {
            try this.readUint{gas: PRICE_CALL_GAS}(position.params.oracle, abi.encodeCall(IOracle.price, ())) returns (
                uint256 oraclePrice
            ) {
                position.oraclePrice = oraclePrice;
                position.hasOraclePrice = true;
            } catch {}
        }

        position.loanToken = getTokenInfo(position.params.loanToken);
        if (position.params.collateralToken != address(0)) {
            position.collateralToken = getTokenInfo(position.params.collateralToken);
        }
    }

    // Returns the vaults in which the user holds shares. Only candidates deployed by one of the
    // factories are vaults - the only way to tell a real Morpho vault from a token pretending to be one.
    // Allocated like the market positions, as there may be hundreds of candidates
    function getVaultPositions(
        address user,
        address[] calldata metaMorphoFactories,
        address[] calldata vaultV2Factories,
        address[] calldata vaultCandidates
    ) internal view returns (VaultPosition[] memory positions) {
        uint256[] memory indexesWithShares = new uint256[](vaultCandidates.length);
        uint256 count = 0;

        for (uint256 i = 0; i < vaultCandidates.length; i++) {
            if (!isMorphoVault(vaultCandidates[i], metaMorphoFactories, vaultV2Factories)) continue;
            if (IERC4626(vaultCandidates[i]).balanceOf(user) == 0) continue;

            indexesWithShares[count] = i;
            count++;
        }

        positions = new VaultPosition[](count);
        for (uint256 i = 0; i < count; i++) {
            positions[i] = getVaultPosition(user, vaultCandidates[indexesWithShares[i]]);
        }
    }

    function isMorphoVault(
        address candidate,
        address[] calldata metaMorphoFactories,
        address[] calldata vaultV2Factories
    ) internal view returns (bool) {
        for (uint256 i = 0; i < metaMorphoFactories.length; i++) {
            if (IMetaMorphoFactory(metaMorphoFactories[i]).isMetaMorpho(candidate)) return true;
        }
        for (uint256 i = 0; i < vaultV2Factories.length; i++) {
            if (IVaultV2Factory(vaultV2Factories[i]).isVaultV2(candidate)) return true;
        }
        return false;
    }

    function getVaultPosition(address user, address vault) internal view returns (VaultPosition memory position) {
        position.vault = vault;
        position.shares = IERC4626(vault).balanceOf(user);

        try IERC4626(vault).convertToAssets(position.shares) returns (uint256 assets) {
            position.assets = assets;
            position.hasAssets = true;
        } catch {}

        position.vaultToken = getTokenInfo(vault);
        position.asset = IERC4626(vault).asset();
        position.assetToken = getTokenInfo(position.asset);
    }

    function getTokenInfo(address token) internal view returns (TokenInfo memory info) {
        try this.readString{gas: TOKEN_CALL_GAS}(token, bytes4(keccak256('symbol()'))) returns (
            string memory symbol
        ) {
            info.symbol = symbol;
        } catch {}

        try this.readString{gas: TOKEN_CALL_GAS}(token, bytes4(keccak256('name()'))) returns (
            string memory name
        ) {
            info.name = name;
        } catch {}

        try this.readDecimals{gas: TOKEN_CALL_GAS}(token) returns (uint8 decimals) {
            info.decimals = decimals;
            info.hasDecimals = true;
        } catch {}
    }
}
