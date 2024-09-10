// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol"; 

using Strings for uint256;

contract Legends is IERC721Metadata, ERC721Enumerable, Ownable {

    constructor() ERC721("AmbireLegends", "AML") Ownable(msg.sender) {}
    
    string baseURI;

    function mint() public {
        // single mint allowed
        // using address for front-end simplification
        _mint(msg.sender, uint256(uint160(msg.sender)));
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, IERC721Metadata) returns (string memory) {
        _requireOwned(tokenId);

        return bytes(baseURI).length > 0 ? string.concat(baseURI, tokenId.toString()) : "";
    }

    function setBaseUri(string calldata _baseURI) public onlyOwner {
        baseURI = _baseURI;
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