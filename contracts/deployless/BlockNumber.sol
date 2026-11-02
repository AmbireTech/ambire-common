// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

// The block number that the RPC and the transaction receipts use. On Arbitrum chains
// `block.number` is a block of the parent chain, so the ArbSys precompile is asked instead.
library BlockNumber {
  address private constant ARB_SYS = address(100);
  // About 7 times what arbBlockNumber() costs. Some chains have a precompile at this address
  // that always fails and takes all the gas it is given, like the deprecated one on BNB Chain
  uint256 private constant ARB_SYS_CALL_GAS = 10000;

  function current() internal view returns (uint256) {
    // ArbSys has a placeholder code, while the other precompiles have none
    if (ARB_SYS.code.length == 0) return block.number;

    (bool success, bytes memory data) = ARB_SYS.staticcall{ gas: ARB_SYS_CALL_GAS }(
      abi.encodeWithSignature('arbBlockNumber()')
    );
    if (success && data.length == 32) return abi.decode(data, (uint256));
    return block.number;
  }
}
