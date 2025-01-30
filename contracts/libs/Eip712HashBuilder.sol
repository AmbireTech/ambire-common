// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './erc4337/PackedUserOperation.sol';
import './Transaction.sol';

library Eip712HashBuilder {
  function getDomainHash() internal view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          keccak256(
            'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)'
          ),
          keccak256(bytes('Ambire')),
          keccak256(bytes('1')),
          block.chainid,
          address(this),
          bytes32(0)
        )
      );
  }

  function getCallsEncoding(Transaction[] memory calls) internal pure returns (bytes32) {
    bytes32[] memory callHashes = new bytes32[](calls.length);

    for (uint256 i = 0; i < calls.length; i++) {
      callHashes[i] = getCallEncoding(calls[i]);
    }

    return keccak256(abi.encodePacked(callHashes));
  }

  function getCallEncoding(Transaction memory call) internal pure returns (bytes32) {
    return
      keccak256(
        abi.encode(
          keccak256(bytes('Transaction(address to,uint256 value,bytes data)')),
          call.to,
          call.value,
          keccak256(call.data)
        )
      );
  }

  function getExecute712Hash(
    uint256 nonce,
    Transaction[] memory calls,
    bytes32 hash
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encodePacked(
          '\x19\x01',
          getDomainHash(),
          keccak256(
            abi.encode(
              keccak256(
                bytes(
                  'AmbireExecuteAccountOp(address account,uint256 chainId,uint256 nonce,Transaction[] calls,bytes32 hash)Transaction(address to,uint256 value,bytes data)'
                )
              ),
              address(this),
              block.chainid,
              nonce,
              getCallsEncoding(calls),
              hash
            )
          )
        )
      );
  }

  function getUserOp712Hash(
    PackedUserOperation memory op,
    Transaction[] memory calls,
    bytes32 hash
  ) internal view returns (bytes32) {
    return
      keccak256(
        abi.encodePacked(
          '\x19\x01',
          getDomainHash(),
          keccak256(
            abi.encode(
              keccak256(
                bytes(
                  // WARNING
                  // removed entryPoint from here as its in the final hash prop. Such a detail is not as important
                  'Ambire4337AccountOp(address account,uint256 chainId,uint256 nonce,bytes initCode,bytes callData,tuple(address, uint256, bytes)[] calls,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData, bytes32 hash)'
                )
              ),
              address(this),
              block.chainid,
              op.nonce,
              op.callData,
              calls,
              op.accountGasLimits,
              op.preVerificationGas,
              op.gasFees,
              op.paymasterAndData,
              hash
            )
          )
        )
      );
  }
}
