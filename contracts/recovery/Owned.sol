// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

contract Owned {
    address public owner;

    modifier owner_only() {
        require(msg.sender == owner);
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setOwner(address newOwner) public owner_only {
        owner = newOwner;
    }
}
