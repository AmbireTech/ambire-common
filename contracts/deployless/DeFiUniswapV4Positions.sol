// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

// Reads the given Uniswap v4 positions (NFTs of the PositionManager) of an account in a single
// call. The PositionManager can't list the positions of an account, so their ids are passed in.
// It returns raw data only: the amounts of the tokens are calculated off-chain, where they can
// be tested.

// Uniswap v4's `PoolKey`. A currency of address(0) is the native token
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct TokenInfo {
    string symbol;
    string name;
    uint8 decimals;
    // False if the token didn't return its decimals; its amounts can't be displayed then
    bool hasDecimals;
}

struct PositionResult {
    uint256 tokenId;
    PoolKey poolKey;
    bytes32 poolId;
    int24 tickLower;
    int24 tickUpper;
    uint128 liquidity;
    // The current price of the pool, as returned by `StateView.getSlot0`
    uint160 sqrtPriceX96;
    // Empty for the native token
    TokenInfo token0;
    TokenInfo token1;
}

interface IPositionManager {
    function ownerOf(uint256 tokenId) external view returns (address);
    // `info` packs: 200 bits truncated poolId | 24 bits tickUpper | 24 bits tickLower | 8 bits hasSubscriber
    function getPoolAndPositionInfo(uint256 tokenId)
        external
        view
        returns (PoolKey memory poolKey, uint256 info);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
}

interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

contract DeFiUniswapV4Positions {
    // Caps the gas of the calls to the tokens, so that a malicious one can't make the whole call
    // run out of gas. Anyone can create a pool with any token
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

    function readDecimals(address target) external view returns (uint8) {
        (bool success, bytes memory data) = target.staticcall(abi.encodeWithSignature('decimals()'));
        require(success && data.length >= 32, 'call failed');

        uint256 decimals = abi.decode(data, (uint256));
        require(decimals <= type(uint8).max, 'invalid decimals');
        return uint8(decimals);
    }

    // Returns only the positions the user still owns and that hold liquidity. A token id the
    // user transferred away, or that was burned, is skipped
    function getUniswapV4Positions(
        address user,
        IPositionManager positionManager,
        IStateView stateView,
        uint256[] calldata tokenIds
    ) external view returns (PositionResult[] memory positions) {
        PositionResult[] memory found = new PositionResult[](tokenIds.length);
        uint256 count = 0;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            // Reverts for a burned position
            try positionManager.ownerOf(tokenIds[i]) returns (address owner) {
                if (owner != user) continue;
            } catch {
                continue;
            }

            uint128 liquidity = positionManager.getPositionLiquidity(tokenIds[i]);
            if (liquidity == 0) continue;

            found[count] = getPosition(positionManager, stateView, tokenIds[i], liquidity);
            count++;
        }

        positions = new PositionResult[](count);
        for (uint256 i = 0; i < count; i++) positions[i] = found[i];
    }

    function getPosition(
        IPositionManager positionManager,
        IStateView stateView,
        uint256 tokenId,
        uint128 liquidity
    ) internal view returns (PositionResult memory position) {
        (PoolKey memory poolKey, uint256 info) = positionManager.getPoolAndPositionInfo(tokenId);

        position.tokenId = tokenId;
        position.poolKey = poolKey;
        position.poolId = keccak256(abi.encode(poolKey));
        position.tickLower = int24(uint24(info >> 8));
        position.tickUpper = int24(uint24(info >> 32));
        position.liquidity = liquidity;
        (position.sqrtPriceX96, , , ) = stateView.getSlot0(position.poolId);
        position.token0 = getTokenInfo(poolKey.currency0);
        position.token1 = getTokenInfo(poolKey.currency1);
    }

    function getTokenInfo(address token) internal view returns (TokenInfo memory info) {
        if (token == address(0)) return info;

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
