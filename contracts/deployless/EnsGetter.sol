// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

interface IUniversalResolver {
  function reverseWithGateways(
    bytes calldata reverseName,
    uint256 coinType,
    string[] calldata gateways
  ) external view returns (string memory resolvedName, address resolver, address reverseResolver);
}

interface IBaseRegistrar {
  function nameExpires(uint256 id) external view returns (uint256);

  function GRACE_PERIOD() external view returns (uint256);
}

interface INameWrapper {
  function getData(uint256 id) external view returns (address owner, uint32 fuses, uint64 expiry);
}

contract EnsGetter {
  struct ReverseLookupResult {
    string resolvedName;
    bool hasName;
    // True when the reverse lookup reverted with an EIP-3668 OffchainLookup, meaning the name
    // lives behind a CCIP-read gateway
    // The caller is expected to retry these addresses off-chain
    bool needsOffchainLookup;
  }

  struct ExpiryResult {
    // Registration expiry, in seconds
    uint256 expiry;
    // Grace period, in seconds. 0 on the NameWrapper path (the wrapper expiry has no separate grace)
    uint256 gracePeriod;
    // block.timestamp of the eth_call, so the caller's updatedAt is consistent with the expiry snapshot
    uint256 blockTimestamp;
  }

  // EIP-3668
  bytes4 constant OFFCHAIN_LOOKUP_SELECTOR = 0x556f1830;

  function getNames(
    address universalResolver,
    address[] calldata addresses,
    uint256 coinType,
    string[] calldata gateways
  ) external view returns (ReverseLookupResult[] memory results) {
    uint256 len = addresses.length;
    results = new ReverseLookupResult[](len);

    for (uint256 i = 0; i < len; i++) {
      if (addresses[i] == address(0)) continue;

      try this.getReverseName(universalResolver, addresses[i], coinType, gateways) returns (
        string memory resolvedName
      ) {
        if (bytes(resolvedName).length == 0) continue;

        results[i].resolvedName = resolvedName;
        results[i].hasName = true;
      } catch (bytes memory err) {
        // A missing/invalid reverse record reverts and should not fail the whole batch.
        // An OffchainLookup revert is surfaced so the caller can resolve it off-chain.
        if (err.length >= 4) {
          bytes4 selector;
          assembly {
            selector := mload(add(err, 0x20))
          }
          if (selector == OFFCHAIN_LOOKUP_SELECTOR) results[i].needsOffchainLookup = true;
        }
      }
    }
  }

  function getReverseName(
    address universalResolver,
    address lookupAddress,
    uint256 coinType,
    string[] calldata gateways
  ) external view returns (string memory resolvedName) {
    (resolvedName, , ) = IUniversalResolver(universalResolver).reverseWithGateways(
      abi.encodePacked(lookupAddress),
      coinType,
      gateways
    );
  }

  // Batches ENS expiry calls. Routing is decided by the caller:
  // - useRegistrar == true: `.eth` 2LD, read from the BaseRegistrar (expiry + separate GRACE_PERIOD).
  // - useRegistrar == false: subnames / non-`.eth` names, read from the NameWrapper (no grace period).
  // `id` is the registrar token id (labelhash of the first label) or the wrapper node (namehash),
  function getExpiry(
    bool useRegistrar,
    address baseRegistrar,
    address nameWrapper,
    uint256 id
  ) external view returns (ExpiryResult memory result) {
    result.blockTimestamp = block.timestamp;

    if (useRegistrar) {
      result.expiry = IBaseRegistrar(baseRegistrar).nameExpires(id);
      result.gracePeriod = IBaseRegistrar(baseRegistrar).GRACE_PERIOD();
    } else {
      (, , uint64 wrapperExpiry) = INameWrapper(nameWrapper).getData(id);
      result.expiry = wrapperExpiry;
    }
  }
}
