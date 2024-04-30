// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import './IAmbireAccount.sol';
import './Simulation.sol';

// Combo of ERC721, enumerable and metadata
// https://eips.ethereum.org/EIPS/eip-721
interface NFT {
  function balanceOf(address _owner) external view returns (uint256);

  function name() external view returns (string memory _name);

  function symbol() external view returns (string memory _symbol);

  function tokenURI(uint256 _tokenId) external view returns (string memory);

  function tokenOfOwnerByIndex(address, uint) external view returns (uint);

  function ownerOf(uint256 _tokenId) external view returns (address);
}

contract NFTGetter is Simulation {
  struct NFTMetadata {
    uint id;
    string uri;
  }
  struct NFTCollectionMetadata {
    string name;
    string symbol;
    NFTMetadata[] nfts;
    bytes error;
  }
  struct NFTCollectionAtNonce {
    NFTCollectionMetadata[] collections;
    uint nonce;
  }

  function getCollectionMeta(
    IAmbireAccount account,
    NFT collection,
    uint[] memory tokenIds,
    uint limit
  ) external view returns (NFTCollectionMetadata memory meta) {
    meta.name = collection.name();
    meta.symbol = collection.symbol();
    if (tokenIds.length == 0) {
      uint balance = collection.balanceOf(address(account));
      if (balance > limit) balance = limit;
      meta.nfts = new NFTMetadata[](balance);
      for (uint i = 0; i != balance; i++) {
        uint tokenId = collection.tokenOfOwnerByIndex(address(account), i);
        meta.nfts[i].id = tokenId;
        meta.nfts[i].uri = collection.tokenURI(tokenId);
      }
    } else {
      uint total;
      for (uint i = 0; i != tokenIds.length; i++) {
        if (total == limit) break;
        if (collection.ownerOf(tokenIds[i]) == address(account)) {
          total++;
        }
      }
      meta.nfts = new NFTMetadata[](total);
      uint j = 0;
      for (uint i = 0; i != tokenIds.length; i++) {
        if (collection.ownerOf(tokenIds[i]) == address(account)) {
          meta.nfts[j].id = tokenIds[i];
          meta.nfts[j].uri = collection.tokenURI(tokenIds[i]);
          j++;
        }
      }
    }
  }

  function getAllNFTs(
    IAmbireAccount account,
    NFT[] memory collections,
    uint[][] memory tokenIds,
    uint tokenPerCollectionLimit
  ) public view returns (NFTCollectionMetadata[] memory) {
    uint len = collections.length;
    NFTCollectionMetadata[] memory collectionMetas = new NFTCollectionMetadata[](len);
    for (uint i = 0; i != len; i++) {
      try
        this.getCollectionMeta{ gas: 7750000 * tokenPerCollectionLimit }(
          account,
          collections[i],
          tokenIds[i],
          tokenPerCollectionLimit
        )
      returns (NFTCollectionMetadata memory meta) {
        collectionMetas[i] = meta;
      } catch (bytes memory err) {
        collectionMetas[i].error = err.length == 0 ? bytes('REVERT') : err;
      }
    }
    return collectionMetas;
  }

  function simulateAndGetAllNFTs(
    IAmbireAccount account,
    address[] memory associatedKeys,
    NFT[] memory collections,
    uint[][] memory tokenIds,
    uint tokenPerCollectionLimit,
    // instead of passing {factory, code, salt}, we'll just have factory and factoryCalldata
    address factory,
    bytes memory factoryCalldata,
    Simulation.ToSimulate[] calldata toSimulate
  )
    external
    returns (
      NFTCollectionAtNonce memory before,
      NFTCollectionAtNonce memory afterSimulation,
      bytes memory /*simulationError*/,
      uint /*gasLeft*/,
      uint /*blockNum*/
    )
  {
    before.collections = getAllNFTs(account, collections, tokenIds, tokenPerCollectionLimit);

    (uint startNonce, bool success, bytes memory err) = Simulation.simulate(
      account,
      associatedKeys,
      factory,
      factoryCalldata,
      toSimulate
    );
    before.nonce = startNonce;

    if (!success) {
      return (before, afterSimulation, err, gasleft(), block.number);
    }

    afterSimulation.nonce = account.nonce();
    if (afterSimulation.nonce != before.nonce) {
      afterSimulation.collections = getAllNFTs(
        account,
        collections,
        tokenIds,
        tokenPerCollectionLimit
      );
    }

    return (before, afterSimulation, bytes(''), gasleft(), block.number);
  }
}
