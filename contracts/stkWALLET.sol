// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

interface IXWallet {
	function shareValue() external view returns (uint);
	function transfer(address to, uint amount) external returns (bool);
	function transferFrom(address from, address to, uint amount) external returns (bool);
}


contract stkWALLET {
	// ERC20 stuff
	// Constants
	string public constant name = "Staked $WALLET";
	uint8 public constant decimals = 18;
	string public constant symbol = "stkWALLET";

	// Immutables
	IXWallet xWallet;

	// Mutable variables
	uint public totalSupply;
	mapping(address => uint) private shares;
	mapping(address => mapping(address => uint)) private allowed;

	// ERC20 events
	event Approval(address indexed owner, address indexed spender, uint amount);
	event Transfer(address indexed from, address indexed to, uint amount);

	// ERC20 methods
	function balanceOf(address owner) external view returns (uint balance) {
		return (shares[owner] * xWallet.shareValue()) / 1e18;
	}

	function transfer(address to, uint amount) external returns (bool success) {
		require(to != address(this), "BAD_ADDRESS");
		uint sharesAmount = (amount * 1e18) / xWallet.shareValue();
		shares[msg.sender] = shares[msg.sender] - sharesAmount;
		shares[to] = shares[to] + sharesAmount;
		emit Transfer(msg.sender, to, amount);
		return true;
	}

	function transferFrom(address from, address to, uint amount) external returns (bool success) {
		uint sharesAmount = (amount * 1e18) / xWallet.shareValue();
		shares[from] = shares[from] - sharesAmount;
		allowed[from][msg.sender] = allowed[from][msg.sender] - amount;
		shares[to] = shares[to] + sharesAmount;
		emit Transfer(from, to, amount);
		return true;
	}

	function approve(address spender, uint amount) external returns (bool success) {
		allowed[msg.sender][spender] = amount;
		emit Approval(msg.sender, spender, amount);
		return true;
	}

	function allowance(address owner, address spender) external view returns (uint remaining) {
		return allowed[owner][spender];
	}

	constructor(IXWallet token) {
		xWallet = token;
	}

	// enter with $WALLLET
	// no need for this atm, we can just use wrap/unwrap
	// function stake(uint amount) external {}

	// @TODO wrapAll?
	// convert xWALLET to stkWALLET
	function wrap(uint shareAmount) external {
		shares[msg.sender] += shareAmount;
		require(xWallet.transferFrom(msg.sender, address(this), shareAmount));
		emit Transfer(address(0), msg.sender, (shareAmount * xWallet.shareValue()) / 1e18);
	}

	// this is used to trigger unstaking
	function unwrap(uint shareAmount) external {
		shares[msg.sender] -= shareAmount;
		require(xWallet.transfer(msg.sender, shareAmount));
		emit Transfer(msg.sender, address(0), (shareAmount * xWallet.shareValue()) / 1e18);
	}
}