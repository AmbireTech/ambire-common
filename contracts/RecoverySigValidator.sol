// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount.sol';
import './libs/SignatureValidator.sol';

contract RecoverySigValidator is ExternalSigValidator {
  mapping(bytes32 => uint) public scheduledRecoveries;
  event LogRecoveryScheduled(
    bytes32 indexed txnHash,
    address indexed recoveryKey,
    uint256 time,
    AmbireAccount.Transaction[] calls
  );
  event LogRecoveryCancelled(
    bytes32 indexed hash,
    address indexed recoveryKey,
    uint256 time
  );
  event LogRecoveryFinalized(bytes32 indexed hash, uint256 time);

  struct RecoveryInfo {
    address[] keys;
    uint256 timelock;
  }

  function validateSig(
    address accountAddr,
    bytes calldata data,
    bytes calldata sig,
    AmbireAccount.Transaction[] calldata calls
  ) external {
    (RecoveryInfo memory recoveryInfo) = abi.decode(data, (RecoveryInfo));
    (bool isCancel, AmbireAccount.Transaction[] memory callsToCommitTo, uint256 salt, bytes memory innerSig) = abi.decode(sig, (
      bool, AmbireAccount.Transaction[], uint256, bytes
    ));
    if (callsToCommitTo.length > 0) {
      bytes32 hash = keccak256(abi.encode(accountAddr, block.chainid, salt, callsToCommitTo));

      uint256 scheduled = scheduledRecoveries[hash];
      require(scheduled == 0, 'RecoverySig: already scheduled');
      require(scheduled != type(uint256).max, 'RecoverySig: already executed');

      bytes32 hashToSign = hash;
      if (isCancel) hashToSign = keccak256(abi.encode(hash, 0x63616E63));
      address recoveryKey = SignatureValidator.recoverAddrImpl(hashToSign, innerSig, true);
      require(isIn(recoveryKey, recoveryInfo.keys), 'RecoverySig: not signed by the correct key');

      if (!isCancel) {
        scheduledRecoveries[hash] = block.timestamp + recoveryInfo.timelock;
        emit LogRecoveryScheduled(hash, recoveryKey, block.timestamp, callsToCommitTo);
      } else {
        scheduledRecoveries[hash] = type(uint256).max;
        emit LogRecoveryCancelled(hash, recoveryKey, block.timestamp);
      }

      // Do not allow execution to proceeed
      require(calls.length == 0, 'RecoverySig: cannot execute when scheduling/cancelling');
    } else {
      bytes32 hash = keccak256(abi.encode(accountAddr, block.chainid, salt, calls));

      uint256 scheduled = scheduledRecoveries[hash];
      require(scheduled != type(uint256).max, 'RecoverySig: already executed');
      require(scheduled != 0, 'RecoverySig: not scheduled');
      require(block.timestamp >= scheduled, 'RecoverySig: not ready');

      scheduledRecoveries[hash] = type(uint256).max;
      emit LogRecoveryFinalized(hash, block.timestamp);
      // Allow execution to proceed
    }
  }

  function isIn(address key, address[] memory keys) internal pure returns (bool) {
    for (uint256 i = 0; i < keys.length; i++) {
      if (key == keys[i]) return true;
    }
    return false;
  }
}
