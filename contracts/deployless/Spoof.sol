// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import './IAmbireAccount.sol';

contract Spoof {
  function makeSpoofSignature(address key) internal pure returns (bytes memory spoofSig) {
    spoofSig = abi.encodePacked(uint256(uint160(key)), uint8(0x03));
  }

  function getSpoof(
    IAmbireAccount account,
    address[] memory associatedKeys
  ) public returns (bytes memory spoofSig) {
    bytes32[] memory associatedKeyPrivileges = new bytes32[](associatedKeys.length);

    for (uint i = 0; i != associatedKeys.length; i++) {
      address key = associatedKeys[i];
      bytes32 value = account.privileges(key);
      associatedKeyPrivileges[i] = value;
      if (value != bytes32(0)) {
        if (spoofSig.length == 0) {
          spoofSig = makeSpoofSignature(key);
          break;
        }
      }
    }
  }
}
