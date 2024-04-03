// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

interface IERC20Subset {
  function balanceOf(address account) external view returns (uint256);

  function transfer(address recipient, uint256 amount) external returns (bool);
}
