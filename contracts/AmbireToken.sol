// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract AmbireToken is ERC20 {
    mapping (address => uint) lastMint;

    uint256 public constant WAIT_TIME = 24 hours;

    uint256 public constant MINT_AMOUNT = 5 * 10 ** 18;

    constructor(uint256 initialSupply) ERC20("Ambire", "AMW") {
        _mint(msg.sender, initialSupply);
    }

    function mint() public {
        require(
            block.timestamp >= lastMint[msg.sender] + WAIT_TIME,
            "Wait 24 hours before minting again"
        );

        lastMint[msg.sender] = block.timestamp;

        _mint(msg.sender, MINT_AMOUNT);
    }
}
