// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

interface IUniversalResolver {
  function reverseWithGateways(
    bytes calldata reverseName,
    uint256 coinType,
    string[] calldata gateways
  ) external view returns (string memory resolvedName, address resolver, address reverseResolver);
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
}
