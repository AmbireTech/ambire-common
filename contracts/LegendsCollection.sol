// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

contract Legends is  ERC721, IERC721Enumerable {

    error ERC721OutOfBoundsIndex(address owner, uint256 index);
    
    uint _totalSupply = 0;    
    mapping(address => uint) _owns;
    
    constructor() ERC721("AmbireLegends", "AML") {}

    function mint() public {
        require(balanceOf(msg.sender) == 0, "NFT already minted");
        // first minted nft is 1
        _mint(msg.sender, ++_totalSupply);
        _owns[msg.sender] = _totalSupply;
    }

    // function supportsInterface(interfaceId) pure returns(bool){
    //     return ERC721;
    // }

    // Enumerable

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }


    function tokenOfOwnerByIndex(address owner, uint256 index) public view virtual returns (uint256) {
        // 1 nft per user at most
        require( index == 0 && balanceOf(owner) != 0, ERC721OutOfBoundsIndex(owner, index));
        return _owns[msg.sender];
    }

    function tokenByIndex(uint256 index) public view virtual returns (uint256) {
        return index + 1;
    }

    // Soulbound
    function approve(address to, uint256 tokenId) public view override(IERC721,ERC721) {
        revert("Soulbound: cannot approve token transfer");
    }

    function setApprovalForAll(address operator, bool approved) public view override(IERC721,ERC721)  {
        revert("Soulbound: cannot set approval for all");
    }

    function transferFrom(address from, address to, uint256 tokenId) public view override(IERC721,ERC721)  {
        revert("Soulbound: cannot transfer nft");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public view override(IERC721,ERC721)  {
        revert("Soulbound: cannot transfer nft");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public view override(IERC721,ERC721)  {
        revert("Soulbound: cannot transfer nft");
    }

}