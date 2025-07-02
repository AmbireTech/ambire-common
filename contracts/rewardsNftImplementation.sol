// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import '@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol';
import '@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Strings.sol';

using Strings for address;
using Strings for uint256;

contract AmbireRewardsNFTImplementation is Ownable, IERC721Metadata, ERC721Enumerable {
  event BatchMetadataUpdate(uint _fromTokenId, uint _toTokenId);
  event MetadataUpdate(uint _tokenId);
  event PickedCharacter(address indexed identity, uint indexed characterType, uint indexed season);

  // intentionally placed but unused
  bool public allowTransfers;
  uint public currentSeason;
  uint public nftIdCounter;
  string public baseURI;
  // address -> season -> character type
  mapping(address identity => mapping(uint season => uint)) public nftTypes;
  // address -> season -> nftId
  mapping(address identity => mapping(uint season => uint)) public nftIds;

  constructor() ERC721('', '') Ownable() {}

  function supportsInterface(
    bytes4 interfaceId
  ) public view override(ERC721Enumerable, IERC165) returns (bool) {
    return interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
  }

  function setSeason(uint season) public onlyOwner {
    currentSeason = season;
  }

  function _mintWithChecks(uint characterType, uint season, address identity) private {
    nftIdCounter++;

    // ok, because the counter starts from 1
    require(nftIds[identity][season] == 0, 'Mint: already has NFT for current season');
    nftIds[identity][season] = nftIdCounter;
    nftTypes[identity][season] = characterType;

    _mint(identity, nftIdCounter);
    emit PickedCharacter(identity, characterType, season);
  }

  // used by users to mint nfts
  function mint(uint characterType, uint season) public {
    // added the season == currentSeason + 1 so the team can test season transition
    require(season == currentSeason || season == currentSeason + 1, 'Mint: wrong season requested');
    _mintWithChecks(characterType, season, msg.sender);
  }

  // used to mint NFTs for season 0
  // split into arrays like this for gas reasons
  // executable only by owner
  function batchMint(
    address[][] calldata identities,
    uint[] calldata characterTypes,
    uint season
  ) public onlyOwner {
    require(
      identities.length == characterTypes.length,
      'batchMint: identities batches length and character types length should be the same'
    );

    for (uint ci = 0; ci < characterTypes.length; ci++) {
      for (uint ii = 0; ii < identities[ci].length; ii++) {
        _mintWithChecks(characterTypes[ci], season, identities[ci][ii]);
      }
    }
  }

  // for updating token metadata in opensea
  // can be used for a single token or for all tokens if passed type(uint).max
  function metadataUpdate(uint tokenId) public {
    emit MetadataUpdate(tokenId);
  }

  // for updating token metadata in opensea for many tokens
  // since token ids are not sequential, we can easily update only items from specific season
  function batchMetadataUpdate(uint from, uint to) public {
    emit BatchMetadataUpdate(from, to);
  }

  function tokenURI(
    uint tokenId
  ) public view override(ERC721, IERC721Metadata) returns (string memory) {
    address nftOwner = _ownerOf(tokenId);

    // not gas efficient but that is ok since this is a view function
    // used i <= currentSeason + 1, because we want to return URIs for the next season as well
    for (uint i = 0; i <= currentSeason + 1; i++) {
      if (nftIds[nftOwner][i] > 0)
        return string(abi.encodePacked(baseURI, nftOwner.toHexString(), '/', i.toString()));
    }
    return
      string(abi.encodePacked(baseURI, address(0).toHexString(), '/', currentSeason.toString()));
  }

  function setBaseUri(string calldata _baseURI) public onlyOwner {
    baseURI = _baseURI;
  }

  function setAllowTransfer(bool value) public onlyOwner {
    allowTransfers = value;
  }

  function burn(uint tokenId) public {
    revert('Soulbound: cannot burn');
  }

  function approve(address recipient, uint tokenId) public override(ERC721, IERC721) {
    revert('Soulbound: cannot approve token transfer');
  }

  function setApprovalForAll(address recipient, bool isApproved) public override(ERC721, IERC721) {
    revert('Soulbound: cannot set approval for all');
  }

  function transferFrom(address from, address to, uint tokenId) public override(ERC721, IERC721) {
    revert('Soulbound: cannot transfer nft');
  }

  function safeTransferFrom(
    address from,
    address to,
    uint tokenId
  ) public override(ERC721, IERC721) {
    revert('Soulbound: cannot transfer nft');
  }

  function safeTransferFrom(
    address from,
    address to,
    uint tokenId,
    bytes memory data
  ) public override(ERC721, IERC721) {
    revert('Soulbound: cannot transfer nft');
  }
}
