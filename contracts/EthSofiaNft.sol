// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import '@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol';
import '@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/Strings.sol';

using Strings for address;

contract EthSofiaNft is IERC721Metadata, ERC721Enumerable, Ownable {
  string baseURI;

  constructor() ERC721('Ambite at ETHSofia', 'AES') Ownable() {}

  function batchMint(address[] calldata recipient) public onlyOwner {
    uint256 numberOfRecipients = recipient.length;
    uint256 currentSupply = totalSupply();
    for (uint i = 0; i < numberOfRecipients; i++) {
      _mint(recipient[i], currentSupply + i);
    }
  }

  function tokenURI(
    uint256 tokenId
  ) public view override(ERC721, IERC721Metadata) returns (string memory) {
    _requireMinted(tokenId);
    return baseURI;
  }

  function setBaseUri(string calldata _baseURI) public onlyOwner {
    baseURI = _baseURI;
  }
}
