// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount.sol';
import './libs/SignatureValidator.sol';

contract RecoverySigValidator is ExternalSigValidator {
  mapping(bytes32 => uint) public scheduledRecoveries;
  event LogRecoveryScheduled(
    bytes32 indexed txnHash,
    address indexed recoveryKey,
    uint256 nonce,
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
    // @TODO comment out
    uint nonce,
    AmbireAccount.Transaction[] calldata calls
  ) external returns (bool shouldExecute) {
    (RecoveryInfo memory recoveryInfo) = abi.decode(data, (RecoveryInfo));
    (bytes32 hashToFinalize, bool isCancel, AmbireAccount.Transaction[] memory callsToCommitTo, uint256 salt, bytes memory innerSig) = abi.decode(sig, (
      bytes32, bool, AmbireAccount.Transaction[], uint256, bytes
    ));

    uint256 scheduled = scheduledRecoveries[hash];

    require(scheduled !== uint256.max, 'RecoverySig: already executed');

    if (callsToCommitTo.length > 0) {
      require(hashToFinalize == bytes32(0), 'RecoverySig: either hashToFinalize or callsToCommitTo');
      require(scheduled == 0, 'RecoverySig: already scheduled');

      bytes32 hash = keccak256(abi.encode(accountAddr, block.chainid, salt, callsToCommitTo));
      
      address recoveryKey = SignatureValidator.recoverAddrImpl(hash, innerSig, true);
      require(isIn(recoveryKey, recoveryInfo.keys), 'RecoverySig: not signed by the correct key');
      scheduledRecoveries[hash] = block.timestamp + recoveryInfo.timelock;
      emit LogRecoveryScheduled(hash, recoveryKey, nonce, block.timestamp, calls);
      // Do not allow execution to proceeed
      require(calls.length === 0, 'RecoverySig: cannot execute when scheduling');
    } else {
      require(hashToFinalize != bytes32(0), 'RecoverySig: either hashToFinalize or callsToCommitTo');
      require(scheduled != 0, 'RecoverySig: not scheduled');

      if (isCancel) {
        bytes32 hashToSign = keccak256(abi.encode(accountAddr, hashToFinalize, isCancel));
        address recoveryKey = SignatureValidator.recoverAddrImpl(hashToSign, innerSig, true);
        require(isIn(recoveryKey, recoveryInfo.keys), 'RecoverySig: cancellation not signed');
        scheduledRecoveries[hashToCancel] = uint256.max;
        emit LogRecoveryCancelled(hashToFinalize, recoveryKey, block.timestamp);
        // Allow execution to proceed; this is safe beecause we have checked that calls are zero length
        require(calls.length == 0, 'RecoverySig: cancellation should have no calls');
      } else {
          require(block.timestamp >= scheduled, 'RecoverySig: not ready');
          scheduledRecoveries[hash] = uint256.max;
          emit LogRecoveryFinalized(hash, block.timestamp);
          // Allow execution to proceed
      }
    }
  }

  function isIn(address key, address[] memory keys) internal pure returns (bool) {
    for (uint256 i = 0; i < keys.length; i++) {
      if (key == keys[i]) return true;
    }
    return false;
  }
}
