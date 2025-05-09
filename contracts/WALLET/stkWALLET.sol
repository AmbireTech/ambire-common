// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

interface IXWallet {
	function balanceOf(address owner) external view returns (uint256);
	function shareValue() external view returns (uint256);
	function transfer(address to, uint256 amount) external returns (bool);
	function transferFrom(address from, address to, uint256 amount) external returns (bool);
	function enter(uint256 amount) external;
	function enterTo(address recipient, uint256 amount) external;
	function governance() external view returns (address);
}

interface IWallet {
	function transferFrom(address from, address to, uint256 amount) external returns (bool);
	function approve(address, uint) external;
}

contract stkWALLET is IXWallet {
	// ERC20 stuff
	// Constants
	string public constant name = "Staked $WALLET";
	uint8 public constant decimals = 18;
	string private constant normalSymbol = "stkWALLET";
	string private constant legacySymbol = "stkWALLETLegacy";
	// Immutables
	IXWallet xWallet;
	IWallet wallet;

	// Mutable variables
	mapping(address => uint256) public shares;
	mapping(address => mapping(address => uint256)) private allowed;
	bool public isDeprecated;

	// ERC20 events
	event Approval(address indexed owner, address indexed spender, uint256 amount);
	event Transfer(address indexed from, address indexed to, uint256 amount);
	// Custom events
	event ShareValueUpdate(uint256 xwalletValue);

	// ERC20 methods
	function symbol() external view returns (string memory) {
		return isDeprecated ? legacySymbol : normalSymbol;
	}

	// Note: any xWALLET sent to this contract will be burned as there's nothing that can be done with it. Expected behavior.
	function totalSupply() external view returns (uint256) {
		return (xWallet.balanceOf(address(this)) * xWallet.shareValue()) / 1e18;
	}

	function balanceOf(address owner) external view returns (uint256 balance) {
		return (shares[owner] * xWallet.shareValue()) / 1e18;
	}

	function transfer(address to, uint256 amount) external returns (bool success) {
		require(to != address(this) && to != address(0), "BAD_ADDRESS");
		uint256 xwalletValue = xWallet.shareValue();
		uint256 sharesAmount = (amount * 1e18) / xwalletValue;
		shares[msg.sender] = shares[msg.sender] - sharesAmount;
		shares[to] = shares[to] + sharesAmount;
		emit Transfer(msg.sender, to, amount);
		emit ShareValueUpdate(xwalletValue);
		return true;
	}

	function transferFrom(address from, address to, uint256 amount) external returns (bool success) {
		require(to != address(this) && to != address(0), "BAD_ADDRESS");
		uint256 xwalletValue = xWallet.shareValue();
		uint256 sharesAmount = (amount * 1e18) / xwalletValue;
		shares[from] = shares[from] - sharesAmount;
		uint256 prevAllowance = allowed[from][msg.sender];
		if (prevAllowance < type(uint256).max) allowed[from][msg.sender] = prevAllowance - amount;
		shares[to] = shares[to] + sharesAmount;
		emit Transfer(from, to, amount);
		emit ShareValueUpdate(xwalletValue);
		return true;
	}

	function approve(address spender, uint256 amount) external returns (bool success) {
		allowed[msg.sender][spender] = amount;
		emit Approval(msg.sender, spender, amount);
		return true;
	}

	function allowance(address owner, address spender) external view returns (uint256 remaining) {
		return allowed[owner][spender];
	}

	constructor(IWallet _wallet, IXWallet _xWallet) {
		wallet = _wallet;
		xWallet = _xWallet;
	}

	// convert xWALLET to stkWALLET
	function wrapAll() external {
		wrap(xWallet.balanceOf(msg.sender));
	}

	function innerMintTo(address to, uint shareAmount) internal {
		shares[to] += shareAmount;
		emit Transfer(address(0), to, (shareAmount * xWallet.shareValue()) / 1e18);
	}

	function wrap(uint256 shareAmount) public {
		require(xWallet.transferFrom(msg.sender, address(this), shareAmount));
		innerMintTo(msg.sender, shareAmount);
	}

	// this is used to trigger unstaking
	function unwrap(uint256 shareAmount) external {
		shares[msg.sender] -= shareAmount;
		require(xWallet.transfer(msg.sender, shareAmount));
		emit Transfer(msg.sender, address(0), (shareAmount * xWallet.shareValue()) / 1e18);
	}

	// convert WALLET to stkWALLET
	function enterTo(address recipient, uint256 amount) public {
		require(wallet.transferFrom(msg.sender, address(this), amount));
		uint256 balanceBefore = xWallet.balanceOf(address(this));
		wallet.approve(address(xWallet), amount);
		xWallet.enter(amount);
		uint256 balanceAfter = xWallet.balanceOf(address(this));

		require(balanceAfter > balanceBefore);
		innerMintTo(recipient, balanceAfter - balanceBefore);
	}

	function enter(uint256 amount) external {
		enterTo(msg.sender, amount);
	}

	// xWALLET interface compat
	function shareValue() external pure returns (uint256) {
		return 1e18;
	}

	function governance() external view returns (address) {
		return xWallet.governance();
	}

	// set deprecated flag
	function setDeprecated(bool _isDeprecated) external {
		require(msg.sender == xWallet.governance(), "NOT_GOVERNANCE");
		isDeprecated = _isDeprecated;
	}
}
