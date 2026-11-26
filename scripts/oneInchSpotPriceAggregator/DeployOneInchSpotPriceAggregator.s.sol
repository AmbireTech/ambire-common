// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

import { MultiWrapper } from 'oneinch/MultiWrapper.sol';
import { OffchainOracle } from 'oneinch/OffchainOracle.sol';
import { IOracle } from 'oneinch/interfaces/IOracle.sol';
import { IUniswapV4StateView } from 'oneinch/interfaces/IUniswapV4StateView.sol';
import { IWrapper } from 'oneinch/interfaces/IWrapper.sol';
import { UniswapV2LikeOracle } from 'oneinch/oracles/UniswapV2LikeOracle.sol';
import { UniswapV3LikeOracle } from 'oneinch/oracles/UniswapV3LikeOracle.sol';
import { UniswapV4LikeOracle } from 'oneinch/oracles/UniswapV4LikeOracle.sol';
import { BaseCoinWrapper } from 'oneinch/wrappers/BaseCoinWrapper.sol';

/// The Foundry cheatcodes this script uses, so that it doesn't need forge-std
interface Vm {
  function envAddress(string calldata name) external view returns (address);
  function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
  function addr(uint256 privateKey) external pure returns (address);
  function startBroadcast() external;
  function startBroadcast(uint256 privateKey) external;
  function stopBroadcast() external;
}

/// Chainlink-compatible USD price feed
interface IPriceFeed {
  function latestRoundData()
    external
    view
    returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
  function decimals() external view returns (uint8);
}

interface IERC20Decimals {
  function decimals() external view returns (uint8);
}

/// Prints to the `forge script` output through Foundry's console address, without forge-std
library ScriptLog {
  address private constant CONSOLE = 0x000000000000000000636F6e736F6c652e6c6f67;

  function log(string memory label, address value) internal view {
    send(abi.encodeWithSignature('log(string,address)', label, value));
  }

  function log(string memory label, uint256 value) internal view {
    send(abi.encodeWithSignature('log(string,uint256)', label, value));
  }

  function send(bytes memory payload) private view {
    (bool sent, ) = CONSOLE.staticcall(payload);
    sent;
  }
}

/**
 * Deploys 1inch's spot price aggregator (`OffchainOracle`) with oracles for the network's Uniswap
 * v2, v3 and v4 pools, for reading token prices from the network's RPC (see `rpcTokenPrices.ts`).
 * Run it through `deploy.sh`, which builds it against a pinned commit of
 * https://github.com/1inch/spot-price-aggregator.
 *
 * The OWNER environment variable sets who owns the aggregator and its wrappers. The owner can add
 * and remove DEX oracles and connector tokens, which changes the prices it returns, so it should
 * be a multisig.
 *
 * The contracts are deployed from DEPLOYER_PRIVATE_KEY when it's set (`deploy.sh` sets it from
 * the PRIVATE_KEY in `.env`), or else from the wallet passed to `forge script` (e.g. `--ledger`).
 *
 * Before anything is sent, the script checks the new aggregator against the network's
 * Chainlink-compatible ETH / USD feed: it prices the network's main USD stablecoin, and the ETH
 * price that implies must be within MAX_FEED_DEVIATION_BPS of the feed's. A failed check reverts
 * the whole run, so nothing is broadcast.
 */
contract DeployOneInchSpotPriceAggregator {
  using ScriptLog for string;

  Vm private constant vm = Vm(address(uint160(uint256(keccak256('hevm cheat code')))));

  /// 1inch's oracles read this connector as "a direct pool between the two tokens"
  address private constant DIRECT_POOL_CONNECTOR = 0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF;
  /// The native token, as 1inch's contracts and Uniswap v4 pools refer to it
  address private constant NATIVE_TOKEN = address(0);
  /// The same threshold `rpcTokenPrices.ts` passes: pools below 10% of the deepest are left out
  uint256 private constant LIQUIDITY_THRESHOLD_PERCENT = 10;
  /// How far the ETH price implied by the stablecoin's rate may be from the feed's: 3%
  uint256 private constant MAX_FEED_DEVIATION_BPS = 300;

  struct UniswapV2Dex {
    string name;
    address factory;
    /// The hash of the pair's creation code, which the oracle derives pair addresses from
    bytes32 initCodeHash;
  }

  struct UniswapV3Dex {
    string name;
    address factory;
    /// The hash of the pool's creation code, which the oracle derives pool addresses from
    bytes32 initCodeHash;
    uint24[] fees;
  }

  struct UniswapV4Dex {
    string name;
    address stateView;
    /// The pools looked up for a pair are every combination of these fees and tick spacings
    uint24[] fees;
    int24[] tickSpacings;
  }

  struct NetworkConfig {
    address wrappedNative;
    /// The tokens a price may be routed through, besides a direct pool
    address[] connectorTokens;
    UniswapV2Dex[] uniswapV2;
    UniswapV3Dex[] uniswapV3;
    UniswapV4Dex[] uniswapV4;
    /// A USD stablecoin with deep pools, priced to check the deployment
    address usdStablecoin;
    /// The ETH / USD feed `rpcTokenPrices.ts` uses on the network
    address nativeUsdFeed;
  }

  struct Deployment {
    BaseCoinWrapper baseCoinWrapper;
    MultiWrapper multiWrapper;
    OffchainOracle offchainOracle;
  }

  function run() external returns (Deployment memory deployment) {
    address owner = vm.envAddress('OWNER');
    require(owner != address(0), 'OWNER is not set');

    NetworkConfig memory config = getNetworkConfig();

    uint256 deployerPrivateKey = vm.envOr('DEPLOYER_PRIVATE_KEY', uint256(0));
    if (deployerPrivateKey == 0) {
      vm.startBroadcast();
    } else {
      string('Deployer').log(vm.addr(deployerPrivateKey));
      vm.startBroadcast(deployerPrivateKey);
    }
    deployment = deploy(config, owner);
    vm.stopBroadcast();

    checkAgainstFeed(deployment.offchainOracle, config);
  }

  function getNetworkConfig() internal view returns (NetworkConfig memory) {
    if (block.chainid == 4663) return robinhoodChain();

    revert('No config for this network');
  }

  /// Robinhood Chain. Its liquidity is on Uniswap v2, v3 and v4, the v4 pools mostly against native ETH.
  function robinhoodChain() internal pure returns (NetworkConfig memory config) {
    address weth = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address usdg = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    config.wrappedNative = weth;
    config.usdStablecoin = usdg;
    config.nativeUsdFeed = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;

    config.connectorTokens = new address[](3);
    config.connectorTokens[0] = DIRECT_POOL_CONNECTOR;
    config.connectorTokens[1] = weth;
    config.connectorTokens[2] = usdg;

    config.uniswapV2 = new UniswapV2Dex[](1);
    config.uniswapV2[0] = UniswapV2Dex({
      name: 'Uniswap v2',
      factory: 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f,
      initCodeHash: 0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f
    });

    uint24[] memory v3Fees = new uint24[](4);
    v3Fees[0] = 100;
    v3Fees[1] = 500;
    v3Fees[2] = 3000;
    v3Fees[3] = 10000;
    config.uniswapV3 = new UniswapV3Dex[](1);
    config.uniswapV3[0] = UniswapV3Dex({
      name: 'Uniswap v3',
      factory: 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA,
      initCodeHash: 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54,
      fees: v3Fees
    });

    int24[] memory v4TickSpacings = new int24[](4);
    v4TickSpacings[0] = 1;
    v4TickSpacings[1] = 10;
    v4TickSpacings[2] = 60;
    v4TickSpacings[3] = 200;
    config.uniswapV4 = new UniswapV4Dex[](1);
    config.uniswapV4[0] = UniswapV4Dex({
      name: 'Uniswap v4',
      stateView: 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b,
      fees: v3Fees,
      tickSpacings: v4TickSpacings
    });
  }

  function deploy(
    NetworkConfig memory config,
    address owner
  ) internal returns (Deployment memory deployment) {
    // Lets callers that pass `useWrappers` price the native token through its wrapped version
    deployment.baseCoinWrapper = new BaseCoinWrapper(
      IERC20(NATIVE_TOKEN),
      IERC20(config.wrappedNative)
    );
    IWrapper[] memory wrappers = new IWrapper[](1);
    wrappers[0] = deployment.baseCoinWrapper;
    deployment.multiWrapper = new MultiWrapper(wrappers, owner);

    uint256 oracleCount = config.uniswapV2.length +
      config.uniswapV3.length +
      config.uniswapV4.length;
    IOracle[] memory oracles = new IOracle[](oracleCount);
    OffchainOracle.OracleType[] memory oracleTypes = new OffchainOracle.OracleType[](oracleCount);
    uint256 oracleIndex = 0;

    for (uint256 i = 0; i < config.uniswapV2.length; i++) {
      UniswapV2Dex memory dex = config.uniswapV2[i];
      oracles[oracleIndex] = new UniswapV2LikeOracle(dex.factory, dex.initCodeHash);
      oracleTypes[oracleIndex] = OffchainOracle.OracleType.WETH;
      string.concat(dex.name, ' oracle').log(address(oracles[oracleIndex]));
      oracleIndex++;
    }

    for (uint256 i = 0; i < config.uniswapV3.length; i++) {
      UniswapV3Dex memory dex = config.uniswapV3[i];
      oracles[oracleIndex] = new UniswapV3LikeOracle(dex.factory, dex.initCodeHash, dex.fees);
      oracleTypes[oracleIndex] = OffchainOracle.OracleType.WETH;
      string.concat(dex.name, ' oracle').log(address(oracles[oracleIndex]));
      oracleIndex++;
    }

    for (uint256 i = 0; i < config.uniswapV4.length; i++) {
      UniswapV4Dex memory dex = config.uniswapV4[i];
      oracles[oracleIndex] = new UniswapV4LikeOracle(
        IUniswapV4StateView(dex.stateView),
        dex.fees,
        dex.tickSpacings
      );
      // Uniswap v4 pools hold native ETH rather than WETH, so the oracle is asked for both
      oracleTypes[oracleIndex] = OffchainOracle.OracleType.WETH_ETH;
      string.concat(dex.name, ' oracle').log(address(oracles[oracleIndex]));
      oracleIndex++;
    }

    IERC20[] memory connectors = new IERC20[](config.connectorTokens.length);
    for (uint256 i = 0; i < config.connectorTokens.length; i++) {
      connectors[i] = IERC20(config.connectorTokens[i]);
    }

    deployment.offchainOracle = new OffchainOracle(
      deployment.multiWrapper,
      oracles,
      oracleTypes,
      connectors,
      IERC20(config.wrappedNative),
      owner
    );

    string('BaseCoinWrapper').log(address(deployment.baseCoinWrapper));
    string('MultiWrapper').log(address(deployment.multiWrapper));
    string('OffchainOracle (the `oracle` in rpcTokenPrices.ts)').log(
      address(deployment.offchainOracle)
    );
  }

  /**
   * Prices the stablecoin the way `rpcTokenPrices.ts` does and reverts unless the ETH price it
   * implies is close to the feed's
   */
  function checkAgainstFeed(OffchainOracle offchainOracle, NetworkConfig memory config) internal view {
    uint256 gasBefore = gasleft();
    uint256 rate = offchainOracle.getRateToEthWithCustomConnectors(
      IERC20(config.usdStablecoin),
      false,
      new IERC20[](0),
      LIQUIDITY_THRESHOLD_PERCENT
    );
    string('Gas used to price the stablecoin').log(gasBefore - gasleft());
    require(rate > 0, 'The aggregator found no price for the stablecoin');

    // `rate` is the wei of ETH per smallest unit of the stablecoin, scaled by 1e18, so one whole
    // stablecoin is worth 10^decimals * rate / 1e18 wei, and one ETH 1e36 / (10^decimals * rate) USD
    IPriceFeed feed = IPriceFeed(config.nativeUsdFeed);
    uint256 feedDecimals = feed.decimals();
    uint256 stablecoinDecimals = IERC20Decimals(config.usdStablecoin).decimals();
    uint256 impliedEthUsd = (10 ** (36 + feedDecimals)) / (10 ** stablecoinDecimals * rate);
    (, int256 feedAnswer, , , ) = feed.latestRoundData();
    require(feedAnswer > 0, 'The ETH / USD feed reported no price');
    uint256 feedEthUsd = uint256(feedAnswer);

    string('ETH / USD implied by the aggregator').log(impliedEthUsd);
    string('ETH / USD reported by the feed').log(feedEthUsd);

    uint256 difference = impliedEthUsd > feedEthUsd
      ? impliedEthUsd - feedEthUsd
      : feedEthUsd - impliedEthUsd;
    require(
      difference * 10_000 <= feedEthUsd * MAX_FEED_DEVIATION_BPS,
      'The aggregator price is too far from the feed'
    );
  }
}
