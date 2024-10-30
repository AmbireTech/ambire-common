// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import '@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol';
import '@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Strings.sol';

using Strings for address;

contract LegendsNFT is IERC721Metadata, ERC721Enumerable, Ownable {
  event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
  event MetadataUpdate(uint256 _tokenId);
  event PickedCharacter(uint indexed heroType);
  bool allowTransfers = false;
  string baseURI;

  constructor() ERC721('Ambire Legends', 'AML') Ownable() {}

  function supportsInterface(
    bytes4 interfaceId
  ) public view override(ERC721Enumerable, IERC165) returns (bool) {
    return interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
  }

  function mint(uint heroType) public {
    // single mint allowed
    // using address for front-end simplification
    _mint(msg.sender, uint256(uint160(msg.sender)));
    emit PickedCharacter(heroType);
    // this line triggers opensea metadata updaate
    emit BatchMetadataUpdate(0, type(uint256).max);
  }

  function tokenURI(
    uint256 tokenId
  ) public view override(ERC721, IERC721Metadata) returns (string memory) {
    _requireMinted(tokenId);
    return string(abi.encodePacked(baseURI, address(uint160(tokenId)).toHexString()));
  }

  function setBaseUri(string calldata _baseURI) public onlyOwner {
    baseURI = _baseURI;
  }

  // this is used only for
  function updateOpenSeaInfo(uint from, uint to) public {
    emit BatchMetadataUpdate(from, to);
  }

  function setAllowTransfer(bool value) public onlyOwner {
    allowTransfers = value;
  }

  function burn(uint256 tokenId) public {
    require(allowTransfers, 'Soulbound: cannot burn');
    require(
      _msgSender() == _ownerOf(tokenId) || _msgSender() == owner(),
      'You cannot burn this NFT.'
    );
    _burn(tokenId);
  }

  function approve(address recipient, uint256 tokenId) public override(ERC721, IERC721) {
    require(allowTransfers, 'Soulbound: cannot approve token transfer');
    _approve(recipient, tokenId);
  }

  function setApprovalForAll(address recipient, bool isApproved) public override(ERC721, IERC721) {
    require(allowTransfers, 'Soulbound: cannot set approval for all');
    _setApprovalForAll(_msgSender(), recipient, isApproved);
  }

  function transferFrom(
    address from,
    address to,
    uint256 tokenId
  ) public override(ERC721, IERC721) {
    require(allowTransfers, 'Soulbound: cannot transfer nft');
    _transfer(from, to, tokenId);
  }

  function safeTransferFrom(
    address from,
    address to,
    uint256 tokenId
  ) public override(ERC721, IERC721) {
    require(allowTransfers, 'Soulbound: cannot transfer nft');
    _safeTransfer(from, to, tokenId, '');
  }

  function safeTransferFrom(
    address from,
    address to,
    uint256 tokenId,
    bytes memory data
  ) public override(ERC721, IERC721) {
    require(allowTransfers, 'Soulbound: cannot transfer nft');
    _safeTransfer(from, to, tokenId, data);
  }
}
