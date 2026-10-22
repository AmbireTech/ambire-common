// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

// Which assets of a page the caller wants metadata for, one byte per asset. A flag
// list is needed because the caller usually knows most of its assets already and only
// the rest have to be read in full, and repeating those assets' addresses in a second
// array would cost a whole word each.
library MetaFlags {
  function has(bytes memory flags, uint256 index) internal pure returns (bool) {
    if (index >= flags.length) return false;

    return uint8(flags[index]) != 0;
  }

  function count(bytes memory flags, uint256 len) internal pure returns (uint256 total) {
    for (uint256 i = 0; i < len; i++) {
      if (has(flags, i)) total++;
    }
  }
}
