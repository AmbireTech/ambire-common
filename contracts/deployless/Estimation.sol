// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./IAmbireAccount.sol";

contract Estimation {
  function makeSpoofSignature(address account) internal pure returns (bytes memory spoofSig) {
    spoofSig = abi.encodePacked(uint256(uint160(account)), uint8(0x03));
  }

  function simulateDeployment(
    IAmbireAccount account,
    address factory, bytes memory factoryCalldata
  ) public returns (uint gasUsed, bool success, bytes memory error) {
    uint gasInitial = gasleft();
    if (address(account).code.length == 0) {
      (success, error) = factory.call(factoryCalldata);
    }
    gasUsed = gasInitial - gasleft();
  }

  function simulateSigned() public {
  }

  function simulateNonSigned() public {
  }

  // @TODO simulateFeePayments
  // @TODO nativeBalances
  // @TODO simulateComplete that also returns gasPrice, nativeBalance
  // @TODO `estimate` takes the `accountOpToExecuteBefore` parameters separately because it's simulated via `simulateSigned`
  // vs the regular accountOp for which we use siimulateNonSigned

}
