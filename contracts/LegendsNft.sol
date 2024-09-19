// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol"; 

using Strings for address;

contract LegendsNFT is IERC721Metadata, ERC721Enumerable, Ownable {
    event PickedCharacter(uint indexed heroType);

    constructor() ERC721("AmbireLegends", "AML") Ownable() {}
    
    string baseURI;

    function mint(uint heroType) public {
        // single mint allowed
        // using address for front-end simplification
        _mint(msg.sender, uint256(uint160(msg.sender)));
        emit PickedCharacter(heroType);
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, IERC721Metadata) returns (string memory) {
        _requireMinted(tokenId);
        return string(abi.encodePacked(baseURI, address(uint160(tokenId)).toHexString()));
    }

    function setBaseUri(string calldata _baseURI) public onlyOwner {
        baseURI = _baseURI;
    }

    // Soulbound
    function approve(address, uint256) public pure override(ERC721, IERC721) {
        revert("Soulbound: cannot approve token transfer");
    }

    function setApprovalForAll(address, bool) public pure override(ERC721, IERC721) {
        revert("Soulbound: cannot set approval for all");
    }

    function transferFrom(address, address, uint256) public pure override(ERC721, IERC721) {
        revert("Soulbound: cannot transfer nft");
    }

    function safeTransferFrom(address, address, uint256) public pure override(ERC721, IERC721) {
        revert("Soulbound: cannot transfer nft");
    }

    function safeTransferFrom(address, address, uint256, bytes memory ) public pure override(ERC721, IERC721) {
        revert("Soulbound: cannot transfer nft");
    }
}
