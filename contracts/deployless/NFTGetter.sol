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

  function supportsInterface(bytes4) external view returns (bool);
}

contract NFTGetter is Simulation {
  // During simulation, we return the delta between the collection before and after the simulation.
  // This array maintains a mapping between the indices of the passed-in token addresses and the tokens listed in the delta array.
  // While returning the token address directly in the before/after collection would be more straightforward,
  // it would result in heavier data for larger token portfolios, making it more CPU-intensive to parse with ethers.
  address[] private deltaAddressesMapping;

  struct NFTCollectionMetadata {
    string name;
    string symbol;
    uint256[] nfts;
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

    uint balance = collection.balanceOf(address(account));
    if (balance > limit) balance = limit;
    meta.nfts = new uint256[](balance);

    bool isEnumerable = collection.supportsInterface(0x780e9d63);

    if (isEnumerable || tokenIds.length == 0) {
      for (uint i = 0; i != balance; i++) {
        uint tokenId = collection.tokenOfOwnerByIndex(address(account), i);
        meta.nfts[i] = tokenId;
      }
    } else {
      uint total;
      for (uint i = 0; i != tokenIds.length; i++) {
        if (total == limit) break;
        // catching the call as we can tolerate errors here because:
        // - on nft mint the token does not exist before the simulation and ownerOf fails
        // - on nft burn the token does not exist after the simulation and ownerOf fails
        try collection.ownerOf(tokenIds[i]) returns (address ownerOfCurrentToken) {
          if (ownerOfCurrentToken == address(account)) {
            total++;
          }
        } catch {}
      }
      meta.nfts = new uint256[](total);
      uint j = 0;
      for (uint i = 0; i != tokenIds.length; i++) {
        try collection.ownerOf(tokenIds[i]) returns (address ownerOfCurrentToken) {
          if (ownerOfCurrentToken == address(account)) {
            meta.nfts[j] = tokenIds[i];
            j++;
          }
        } catch {}
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
        this.getCollectionMeta{ gas: 50000 * tokenPerCollectionLimit }(
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

  // Compare the collections before (collectionsA) and after simulation (collectionsB)
  // and return the delta (with simulation)
  function getDelta(
    NFTCollectionMetadata[] memory collectionsA,
    NFTCollectionMetadata[] memory collectionsB,
    NFT[] memory collections
  ) public returns (NFTCollectionMetadata[] memory) {
    uint deltaSize = 0;

    for (uint256 i = 0; i < collectionsA.length; i++) {
      // Compare hashes of the arrays
      bytes32 hashA = keccak256(abi.encode(collectionsA[i].nfts));
      bytes32 hashB = keccak256(abi.encode(collectionsB[i].nfts));
      if (hashA != hashB) {
        deltaSize++;
      }
    }

    NFTCollectionMetadata[] memory delta = new NFTCollectionMetadata[](deltaSize);
    deltaAddressesMapping = new address[](deltaSize);

    // Second loop to populate the delta array
    // Separate index for the delta array
    uint256 deltaIndex = 0;
    for (uint256 i = 0; i < collectionsA.length; i++) {
      // Compare hashes of the arrays
      bytes32 hashA = keccak256(abi.encode(collectionsA[i].nfts));
      bytes32 hashB = keccak256(abi.encode(collectionsB[i].nfts));
      if (hashA != hashB) {
        delta[deltaIndex] = collectionsB[i];
        deltaAddressesMapping[deltaIndex] = address(collections[i]);
        deltaIndex++;
      }
    }

    return delta;
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
      uint /*blockNum*/,
      address[] memory // deltaAddressesMapping
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
      return (before, afterSimulation, err, gasleft(), block.number, deltaAddressesMapping);
    }

    afterSimulation.nonce = account.nonce();
    if (afterSimulation.nonce != before.nonce) {
      afterSimulation.collections = getAllNFTs(
        account,
        collections,
        tokenIds,
        tokenPerCollectionLimit
      );

      NFTCollectionMetadata[] memory deltaAfter = getDelta(
        before.collections,
        afterSimulation.collections,
        collections
      );
      afterSimulation.collections = deltaAfter;
    }

    return (before, afterSimulation, bytes(''), gasleft(), block.number, deltaAddressesMapping);
  }
}
