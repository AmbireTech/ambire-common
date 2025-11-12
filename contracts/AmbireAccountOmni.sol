// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount7702.sol';
import { MerkleProof } from '@openzeppelin/contracts/utils/cryptography/MerkleProof.sol';
import './composable/types/ComposabilityDataTypes.sol';
import './composable/lib/ComposableExecutionLib.sol';

/**
 * @notice A contract that extends AmbireAccount7702 to make it cross-chain compatible 7702 adaptable
 * @dev This contract is composable, meaning there could be dynamic data commitments
 */
contract AmbireAccountOmni is AmbireAccount7702 {
  using ComposableExecutionLib for InputParam[];
  using ComposableExecutionLib for OutputParam[];

  address public immutable entryPoint;

  constructor(address _entryPoint) {
    require(_entryPoint != address(0));
    entryPoint = _entryPoint;
  }

  function privileges(address key) public view override returns (bytes32) {
    if (key == address(this)) return bytes32(uint256(2));

    // if the entry point is the sender, we return the marker priv
    if (key == entryPoint) return ENTRY_POINT_MARKER;

    return getAmbireStorage().privileges[key];
  }

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
      merkleTreeRoot,
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
      userOpHash,
      op.signature,
      true,
      mode
    );
    if (privileges(signer) == bytes32(0)) return SIG_VALIDATION_FAILED;

    return SIG_VALIDATION_SUCCESS;
  }

  /**
   * @notice  Allows composable executions if the caller itself is authorized
   * @dev     no need for nonce management here cause we're not dealing with sigs
   * @param   executions  the composable transaction we're executing
   */
  function executeComposableBySender(ComposableExecution[] calldata executions) external payable {
    require(privileges(msg.sender) != bytes32(0), 'INSUFFICIENT_PRIVILEGE');

    uint256 length = executions.length;
    for (uint256 i; i < length; i++) {
      ComposableExecution calldata execution = executions[i];
      bytes memory composedCalldata = execution.inputParams.processInputs(execution.functionSig);
      bytes memory returnData;
      if (execution.to != address(0)) {
        returnData = executeCall(execution.to, execution.value, composedCalldata);
      } else {
        returnData = new bytes(0);
      }
      execution.outputParams.processOutputs(returnData, address(this));
    }

    // again, anti-bricking
    require(privileges(msg.sender) != bytes32(0), 'PRIVILEGE_NOT_DOWNGRADED');
  }
}
