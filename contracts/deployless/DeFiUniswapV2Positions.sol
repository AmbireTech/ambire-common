// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

// Reads an account's Uniswap V2 positions in a single call. A position is the pair's liquidity
// token, so the tokens the account holds are passed in, and only those that the Uniswap V2 factory
// deployed as pairs are read. It returns raw data only: the account's share of the reserves is
// calculated off-chain, where it can be tested.

struct TokenInfo {
    string symbol;
    string name;
    uint8 decimals;
    // False if the token didn't return its decimals; its amounts can't be displayed then
    bool hasDecimals;
}

struct PairPosition {
    address pair;
    // The liquidity tokens of the account and their total supply
    uint256 balance;
    uint256 totalSupply;
    address token0;
    address token1;
    uint256 reserve0;
    uint256 reserve1;
    TokenInfo token0Info;
    TokenInfo token1Info;
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32);
    function totalSupply() external view returns (uint256);
}

contract DeFiUniswapV2Positions {
    // Caps the gas of the calls to the tokens, so that a malicious one can't make the whole call
    // run out of gas. The candidates are any tokens the account holds
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

    function readAddress(address target, bytes calldata callData) external view returns (address) {
        (bool success, bytes memory data) = target.staticcall(callData);
        require(success && data.length >= 32, 'call failed');

        return abi.decode(data, (address));
    }

    // Returns only the pairs of the factory in which the user has liquidity tokens
    function getUniswapV2Positions(
        address user,
        IUniswapV2Factory factory,
        address[] calldata candidates
    ) external view returns (PairPosition[] memory positions) {
        PairPosition[] memory found = new PairPosition[](candidates.length);
        uint256 count = 0;

        for (uint256 i = 0; i < candidates.length; i++) {
            (bool isPair, address token0, address token1) = getPairTokens(factory, candidates[i]);
            if (!isPair) continue;

            // A pair the factory deployed, so it's trusted from here on
            uint256 balance = IERC20Balance(candidates[i]).balanceOf(user);
            if (balance == 0) continue;

            found[count] = getPairPosition(candidates[i], balance, token0, token1);
            count++;
        }

        positions = new PairPosition[](count);
        for (uint256 i = 0; i < count; i++) positions[i] = found[i];
    }

    // Anyone can deploy a token that returns any token0 and token1, so the factory must have
    // deployed it as the pair of these tokens
    function getPairTokens(IUniswapV2Factory factory, address candidate)
        internal
        view
        returns (bool isPair, address token0, address token1)
    {
        try this.readAddress{gas: TOKEN_CALL_GAS}(candidate, abi.encodeWithSignature('token0()'))
        returns (address result) {
            token0 = result;
        } catch {
            return (false, token0, token1);
        }

        try this.readAddress{gas: TOKEN_CALL_GAS}(candidate, abi.encodeWithSignature('token1()'))
        returns (address result) {
            token1 = result;
        } catch {
            return (false, token0, token1);
        }

        isPair = factory.getPair(token0, token1) == candidate;
    }

    function getPairPosition(address pair, uint256 balance, address token0, address token1)
        internal
        view
        returns (PairPosition memory position)
    {
        position.pair = pair;
        position.balance = balance;
        position.totalSupply = IUniswapV2Pair(pair).totalSupply();
        position.token0 = token0;
        position.token1 = token1;
        (uint112 reserve0, uint112 reserve1, ) = IUniswapV2Pair(pair).getReserves();
        position.reserve0 = reserve0;
        position.reserve1 = reserve1;
        position.token0Info = getTokenInfo(token0);
        position.token1Info = getTokenInfo(token1);
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

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}
