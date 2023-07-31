// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount.sol';

contract Recoveries {
  mapping(bytes32 => uint) public scheduledRecoveries;
  event LogRecoveryScheduled(
    bytes32 indexed txnHash,
    address indexed recoveryKey,
    uint256 nonce,
    uint256 time,
    AmbireAccount.Transaction[] calls
  );
  event LogRecoveryCancelled(
    bytes32 indexed txnHash,
    address indexed recoveryKey,
    uint256 time
  );
  event LogRecoveryFinalized(bytes32 indexed txnHash, uint256 time);

  struct RecoveryInfo {
    address[] keys;
    uint256 timelock;
  }
}
