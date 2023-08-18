// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount.sol';
import './libs/SignatureValidator.sol';

contract TimelockedRecoverySig is ExternalSigValidator {
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

  function validateSig(
    address accountAddr,
    bytes calldata data,
    bytes calldata sig,
    uint nonce,
    AmbireAccount.Transaction[] calldata calls
  ) external returns (bool shouldExecute) {
    (RecoveryInfo memory recoveryInfo) = abi.decode(data, (RecoveryInfo));
    (bytes32 cancellationHash, bytes memory innerSig) = abi.decode(sig, (bytes32, bytes));

    bytes32 hash = keccak256(abi.encode(accountAddr, block.chainid, nonce, calls));
    uint256 scheduled = scheduledRecoveries[hash];

    if (cancellationHash != bytes32(0) && scheduled > 0) {
      bytes32 hashToSign = keccak256(abi.encode(cancellationHash, 0x63616E63));
      address recoveryKey = SignatureValidator.recoverAddrImpl(hashToSign, innerSig, true);
      require(isIn(recoveryKey, recoveryInfo.keys), 'RecoverySig: cancellation not signed');
      delete scheduledRecoveries[cancellationHash];
      emit LogRecoveryCancelled(cancellationHash, recoveryKey, block.timestamp);
      // Allow execution to proceed; this is safe beecause we have checked that calls are zero length
      require(calls.length == 0, 'RecoverySig: cancellation should have no calls');
      return true;
    }

    if (scheduled > 0) {
      require(block.timestamp >= scheduled, 'RECOVERY_NOT_READY');
      delete scheduledRecoveries[hash];
      emit LogRecoveryFinalized(hash, block.timestamp);
      // Allow execution to proceed
      return true;
    } else {
      address recoveryKey = SignatureValidator.recoverAddrImpl(hash, innerSig, true);
      require(isIn(recoveryKey, recoveryInfo.keys), 'RecoverySig: not signed by the correct key');
      scheduledRecoveries[hash] = block.timestamp + recoveryInfo.timelock;
      emit LogRecoveryScheduled(hash, recoveryKey, nonce, block.timestamp, calls);
      // Do not allow execution to proceeed
      return false;
    }
  }

  function isIn(address key, address[] memory keys) internal pure returns (bool) {
    for (uint256 i = 0; i < keys.length; i++) {
      if (key == keys[i]) return true;
    }
    return false;
  }
}
