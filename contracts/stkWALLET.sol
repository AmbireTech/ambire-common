// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

interface IXWallet {
	function balanceOf(address owner) external view returns (uint256);
	function shareValue() external view returns (uint256);
	function transfer(address to, uint256 amount) external returns (bool);
	function transferFrom(address from, address to, uint256 amount) external returns (bool);
	function enter(uint256 amount) external;
	function timeToUnbond() view external returns (uint);
	function leave(uint shares, bool skipMint) external returns(uint);
	function withdraw(uint shares, uint unlocksAt, bool skipMint) external;
	function rageLeave(uint shares, bool skipMint) external;
}

interface IWallet {
	function transferFrom(address from, address to, uint256 amount) external returns (bool);
	function approve(address, uint) external;
	function balanceOf(address owner) external view returns (uint256);
	function transfer(address to, uint256 amount) external returns (bool);
}

contract stkWALLET {
	// ERC20 stuff
	// Constants
	string public constant name = "Staked $WALLET";
	uint8 public constant decimals = 18;
	string public constant symbol = "stkWALLET";

	// Immutables
	IXWallet xWallet;
	IWallet wallet;

	// Mutable variables
	mapping(address => uint256) public shares;
	mapping(address => mapping(address => uint256)) private allowed;

	// ERC20 events
	event Approval(address indexed owner, address indexed spender, uint256 amount);
	event Transfer(address indexed from, address indexed to, uint256 amount);
	// Custom events
	event ShareValueUpdate(uint256 shareValue);

	// stkWallet specific methods
	struct UnbondCommitment {
		address owner;
		uint shares;
		uint unlocksAt;
	}

	mapping(address => uint256) public locked;
	mapping(bytes32 => uint256) public commitmentPayout;
		
	event LogLeave(address indexed owner, uint amount, uint unlocksAt);
	event LogWithdraw(address indexed owner, uint shares, uint unlocksAt);
	event LogRageLeave(address indexed owner, uint amount);


	// ERC20 methods
	// Note: any xWALLET sent to this contract will be burned as there's nothing that can be done with it. Expected behavior.
	function totalSupply() external view returns (uint256) {
		return (xWallet.balanceOf(address(this)) * xWallet.shareValue()) / 1e18;
	}

	function balanceOf(address owner) external view returns (uint256 balance) {
		return (shares[owner] * xWallet.shareValue()) / 1e18 + locked[owner];
	}

	function transfer(address to, uint256 amount) external returns (bool success) {
		require(to != address(this) && to != address(0), "BAD_ADDRESS");
		uint256 shareValue = xWallet.shareValue();
		uint256 sharesAmount = (amount * 1e18) / shareValue;
		shares[msg.sender] = shares[msg.sender] - sharesAmount;
		shares[to] = shares[to] + sharesAmount;
		emit Transfer(msg.sender, to, amount);
		emit ShareValueUpdate(shareValue);
		return true;
	}

	function transferFrom(address from, address to, uint256 amount) external returns (bool success) {
		require(to != address(this) && to != address(0), "BAD_ADDRESS");
		uint256 shareValue = xWallet.shareValue();
		uint256 sharesAmount = (amount * 1e18) / shareValue;
		shares[from] = shares[from] - sharesAmount;
		uint256 prevAllowance = allowed[from][msg.sender];
		if (prevAllowance < type(uint256).max) allowed[from][msg.sender] = prevAllowance - amount;
		shares[to] = shares[to] + sharesAmount;
		emit Transfer(from, to, amount);
		emit ShareValueUpdate(shareValue);
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
	function stakeAndWrap(uint256 amount) external {
		require(wallet.transferFrom(msg.sender, address(this), amount));
		uint256 balanceBefore = xWallet.balanceOf(address(this));
		wallet.approve(address(xWallet), amount);
		xWallet.enter(amount);
		uint256 balanceAfter = xWallet.balanceOf(address(this));

		require(balanceAfter > balanceBefore);
		innerMintTo(msg.sender, balanceAfter - balanceBefore);
	}


	// here we are requesting stkWALLET amount for humanization reasons
	function leaveExact(uint256 requestedAmount) public {
		uint256 shareValue = xWallet.shareValue();
		require(requestedAmount >= shares[msg.sender] * shareValue, "INSUFFICIENT_FUNDS");

		uint256 actualSharesLeave = requestedAmount / shareValue;
		shares[msg.sender] -= actualSharesLeave;
		locked[msg.sender] += actualSharesLeave;

		uint256 unlocksAt = block.timestamp + xWallet.timeToUnbond();
		bytes32 commitmentId = keccak256(abi.encode(UnbondCommitment({ owner: msg.sender, shares: actualSharesLeave, unlocksAt: unlocksAt })));
		
		// @TODO should the skipMint be true
		xWallet.leave(actualSharesLeave,true);
		require(commitmentPayout[commitmentId]==0, "COMMITMENT_ALREADY_PRESENT");
		commitmentPayout[commitmentId] = actualSharesLeave;

		emit LogLeave(msg.sender, requestedAmount, unlocksAt);
	}

	function leaveAll() public {
		leaveExact(shares[msg.sender]*xWallet.shareValue());
	}
	// we are ok with not knowing the exact WALLET amount in the humanizer
	// since the simulation with display the exact amount 
	function withdraw(uint requestedShares, uint unlocksAt) public {
		require(unlocksAt<= block.timestamp, "UNLOCK_TOO_EARLY");
		bytes32 commitmentId = keccak256(abi.encode(UnbondCommitment({ owner: msg.sender, shares: requestedShares, unlocksAt: unlocksAt })));
		// @TODO can we simply check if it is a positive value
		// @TODO better revert message
		require(commitmentPayout[commitmentId] > 0, "Requesting too much to withdraw");
		
		uint balanceBefore = wallet.balanceOf(address(this));	
		// @TODO should the skipMint be true
		xWallet.withdraw(requestedShares, unlocksAt, true);
		uint balanceAfter = wallet.balanceOf(address(this));
		wallet.transfer(msg.sender, balanceAfter-balanceBefore);

		commitmentPayout[commitmentId] = 0;
		locked[msg.sender] -= requestedShares;

		emit LogWithdraw(msg.sender, balanceAfter-balanceBefore, unlocksAt);

	}


	function rageLeave(uint requestedShares) public {
		require(shares[msg.sender]>requestedShares, "INSUFFICIENT_FUNDS");
		shares[msg.sender]-=requestedShares;

		uint walletBalanceBefore = wallet.balanceOf(address(this));
		xWallet.rageLeave(requestedShares, true);
		uint walletBalanceAfter = wallet.balanceOf(address(this));
		
		uint amount = walletBalanceAfter-walletBalanceBefore;
		wallet.transfer(msg.sender, amount);

		emit LogRageLeave(msg.sender, amount);
	}
}
