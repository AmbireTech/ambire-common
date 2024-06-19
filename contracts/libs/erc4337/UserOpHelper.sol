// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

library UserOpHelper {
	uint256 public constant PAYMASTER_ADDR_OFFSET = 20;

  // 52 = 20 address + 16 paymasterVerificationGasLimit + 16 paymasterPostOpGasLimit
	uint256 public constant PAYMASTER_DATA_OFFSET = 52;
}
