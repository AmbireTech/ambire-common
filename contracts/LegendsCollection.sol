// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract Legends is ERC721Enumerable {
    constructor() ERC721("AmbireLegends", "AML") {}

    function mint() public {
        require(balanceOf(msg.sender) == 0, "NFT already minted");
        // first minted nft is 1
        _mint(msg.sender, totalSupply());
    }

    // Soulbound
    function approve(address to, uint256 tokenId) public view override(ERC721, IERC721) {
        revert("Soulbound: cannot approve token transfer");
    }

    function setApprovalForAll(address operator, bool approved) public view override(ERC721, IERC721) {
        revert("Soulbound: cannot set approval for all");
    }

    function transferFrom(address from, address to, uint256 tokenId) public view override(ERC721, IERC721) {
        revert("Soulbound: cannot transfer nft");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public view override(ERC721, IERC721) {
        revert("Soulbound: cannot transfer nft");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public view override(ERC721, IERC721) {
        revert("Soulbound: cannot transfer nft");
    }
}