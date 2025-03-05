// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './erc4337/PackedUserOperation.sol';
import './Transaction.sol';
import '../deployless/IAmbireAccount.sol';

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
    Transaction[] calldata calls,
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
    PackedUserOperation calldata op,
    bytes32 hash
  ) internal view returns (bytes32) {
    // decode the calls if any
    Transaction[] memory calls;
    if (op.callData.length >= 4) {
      bytes4 functionSig = bytes4(op.callData[0:4]);

      if (functionSig == IAmbireAccount.executeBySender.selector) {
        calls = abi.decode(op.callData[4:], (Transaction[]));
      } else if (functionSig == IAmbireAccount.execute.selector) {
        (calls, ) = abi.decode(op.callData[4:], (Transaction[], bytes));
      }
    }

    return
      keccak256(
        abi.encodePacked(
          '\x19\x01',
          getDomainHash(),
          keccak256(
            abi.encode(
              keccak256(
                bytes(
                  // removed entryPoint from here as its in the final hash prop
                  'Ambire4337AccountOp(address account,uint256 chainId,uint256 nonce,bytes initCode,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes callData,Transaction[] calls,bytes32 hash)Transaction(address to,uint256 value,bytes data)'
                )
              ),
              address(this),
              block.chainid,
              op.nonce,
              keccak256(op.initCode),
              op.accountGasLimits,
              op.preVerificationGas,
              op.gasFees,
              keccak256(op.paymasterAndData),
              keccak256(op.callData),
              getCallsEncoding(calls),
              hash
            )
          )
        )
      );
  }
}
