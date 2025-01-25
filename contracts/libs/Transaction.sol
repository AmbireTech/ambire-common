// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

// Transaction structure
// we handle replay protection separately by requiring (address(this), chainID, nonce) as part of the sig
// @dev a better name for this would be `Call`, but we are keeping `Transaction` for backwards compatibility
struct Transaction {
    address to;
    uint256 value;
    bytes data;
}
