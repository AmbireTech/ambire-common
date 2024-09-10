// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract Legends is  ERC721 {

    error ERC721OutOfBoundsIndex(address owner, uint256 index);
    
    uint totalSupply = 0;    
    mapping(address => uint) _owns;
    
    constructor() ERC721("AmbireLegends", "AML") {}

    function mint() public {
        require(balanceOf(msg.sender) == 0, "NFT already minted");
        // first minted nft is 1
        _mint(address(msg.sender), ++totalSupply);
        _owns[msg.sender] = totalSupply;
    }

    // Enumerable
    function tokenOfOwnerByIndex(address owner, uint256 index) public view virtual returns (uint256) {
        // 1 nft per user at most
        require( index == 0 && balanceOf(owner) != 0, ERC721OutOfBoundsIndex(owner, index));
        return _owns[msg.sender];
    }

    function tokenByIndex(uint256 index) public view virtual returns (uint256) {
        return index + 1;
    }

    // Soulbound
    function approve(address to, uint256 tokenId) public view override {
        revert("Soulbound: cannot approve token transfer");
    }

    function setApprovalForAll(address operator, bool approved) public view override {
        revert("Soulbound: cannot set approval for all");
    }

    function transferFrom(address from, address to, uint256 tokenId) public view override {
        revert("Soulbound: cannot transfer nft");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public view override {
        revert("Soulbound: cannot transfer nft");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public view override {
        revert("Soulbound: cannot transfer nft");
    }

}