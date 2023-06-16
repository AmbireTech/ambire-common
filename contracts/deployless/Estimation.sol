// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

contract Estimation {
  function makeSpoofSignature(address account) internal pure returns (bytes memory spoofSig) {
    spoofSig = abi.encodePacked(uint256(uint160(account)), uint8(0x03));
  }

  function simulateDeployment() {
  }

  function simulateSigned() {
  }

  function simulateNonSigned() {
  }

  // @TODO simulateFeePayments
  // @TODO nativeBalances
  // @TODO simulateComplete that also returns gasPrice, nativeBalance
  // @TODO `estimate` takes the `accountOpToExecuteBefore` parameters separately because it's simulated via `simulateSigned`
  // vs the regular accountOp for which we use siimulateNonSigned
}
