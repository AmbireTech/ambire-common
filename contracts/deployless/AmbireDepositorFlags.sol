// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

// Tells which addresses are Ambire accounts by their code hash, many at a time, so a Privacy
// Pools sync can learn which deposits came from Ambire accounts in one call.
contract AmbireDepositorFlags {
  // `packedAddrs` holds 20 bytes per address, not ABI-padded, so 1000 addresses fit under the
  // 24 KB calldata limit of the constructor mode. Returns one byte per address, 0x01 when its
  // code hash is one of `knownCodeHashes`, else 0x00.
  function getFlags(
    bytes memory packedAddrs,
    bytes32[] memory knownCodeHashes
  ) external view returns (bytes memory flags) {
    require(packedAddrs.length % 20 == 0, 'packedAddrs: not 20 bytes per address');

    uint256 count = packedAddrs.length / 20;
    flags = new bytes(count);
    for (uint256 i = 0; i < count; i++) {
      address addr;
      assembly {
        addr := shr(96, mload(add(add(packedAddrs, 32), mul(i, 20))))
      }

      bytes32 codeHash = addr.codehash;
      for (uint256 j = 0; j < knownCodeHashes.length; j++) {
        if (codeHash == knownCodeHashes[j]) {
          flags[i] = 0x01;
          break;
        }
      }
    }
  }
}
