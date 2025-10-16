// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount7702.sol';
import { MerkleProof } from '@openzeppelin/contracts/utils/cryptography/MerkleProof.sol';

/**
 * @notice A contract that extends AmbireAccount7702 to make it cross-chain compatible 7702 adaptable
 * @dev We hardcode the entry point address so we don't have to use
 * any storage slots after authorization. If it changes, the users
 * will have to authrorize another contract with the new entry point addr
 * to continue
 */
contract AmbireAccountOmni is AmbireAccount7702 {
  /**
   * Helper to pack the return value for validateUserOp, when not using an aggregator.
   * @param sigFailed  - True for signature failure, false for success.
   * @param validUntil - Last timestamp this UserOperation is valid (or zero for infinite).
   * @param validAfter - First timestamp this UserOperation is valid.
   */
  function _packValidationData(
    bool sigFailed,
    uint48 validUntil,
    uint48 validAfter
  ) internal pure returns (uint256) {
    return (sigFailed ? 1 : 0) | (uint256(validUntil) << 160) | (uint256(validAfter) << (160 + 48));
  }

  function _validateMerkleProofs(
    bytes memory userOpSig,
    bytes32 userOpHash
  ) internal view returns (uint256) {
    (
      uint48 validUntil,
      uint48 validAfter,
      bytes32 merkleTreeRoot,
      bytes32[] memory merkleProof,
      bytes memory multichainSignature
    ) = abi.decode(userOpSig, (uint48, uint48, bytes32, bytes32[], bytes));

    //make a leaf out of userOpHash, validUntil and validAfter
    bytes32 leaf = keccak256(abi.encodePacked(validUntil, validAfter, userOpHash));
    if (!MerkleProof.verify(merkleProof, merkleTreeRoot, leaf)) {
      revert('Invalid UserOp');
    }

    (address merkleSigner, ) = SignatureValidator.recoverAddrAllowUnprotected(
      userOpHash,
      multichainSignature,
      true
    );
    if (privileges(merkleSigner) == bytes32(0)) return SIG_VALIDATION_FAILED;

    return
      _packValidationData(
        false, //sigVerificationFailed = false
        validUntil == 0 ? type(uint48).max : validUntil,
        validAfter
      );
  }

  /**
   * @notice  EIP-4337 implementation
   * @dev     Use this to extend functionality for Merkle proofs
   * @param   op  the PackedUserOperation we're executing
   * @param   userOpHash  the hash we've committed to
   * @param   missingAccountFunds  the funds the account needs to pay
   * @return  uint256  0 for success, 1 for signature failure, and a uint256
   * packed timestamp for a future valid signature:
   * address aggregator, uint48 validUntil, uint48 validAfter
   */
  function validateUserOp(
    PackedUserOperation calldata op,
    bytes32 userOpHash,
    uint256 missingAccountFunds
  ) external payable override returns (uint256) {
    require(privileges(msg.sender) == ENTRY_POINT_MARKER, 'validateUserOp: not from entryPoint');

    // @estimation
    // paying should happen even if signature validation fails
    if (missingAccountFunds > 0) {
      // NOTE: MAY pay more than the minimum, to deposit for future transactions
      (bool success, ) = msg.sender.call{ value: missingAccountFunds }('');
      // ignore failure (its EntryPoint's job to verify, not account.)
      (success);
    }

    // merkle tree proof handle
    SignatureValidator.SignatureMode mode = SignatureValidator.getSignatureMode(op.signature);
    if (mode == SignatureValidator.SignatureMode.MerkleTree) {
      return _validateMerkleProofs(op.signature, userOpHash);
    }

    // this is replay-safe because userOpHash is retrieved like this: keccak256(abi.encode(userOp.hash(), address(this), block.chainid))
    (address signer, ) = SignatureValidator.recoverAddrAllowUnprotectedWithMode(
      Eip712HashBuilder.getUserOp712Hash(op, userOpHash),
      op.signature,
      true,
      mode
    );
    if (privileges(signer) == bytes32(0)) return SIG_VALIDATION_FAILED;

    return SIG_VALIDATION_SUCCESS;
  }
}
