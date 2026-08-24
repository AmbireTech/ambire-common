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
    // Optional metadata, missing on collections like the ENS names one
    try collection.name() returns (string memory name) {
      meta.name = name;
    } catch {}
    try collection.symbol() returns (string memory symbol) {
      meta.symbol = symbol;
    } catch {}

    uint balance = collection.balanceOf(address(account));
    if (balance > limit) balance = limit;
    meta.nfts = new uint256[](balance);

    bool isEnumerable = collection.supportsInterface(0x780e9d63);

    if (isEnumerable || tokenIds.length == 0) {
      // A collection can report the interface and still not implement it, and a
      // collection with no ids to check is walked as if it were enumerable, so
      // the enumeration is allowed to fail without discarding the collection
      uint owned;
      for (uint i = 0; i != balance; i++) {
        try collection.tokenOfOwnerByIndex(address(account), i) returns (uint tokenId) {
          meta.nfts[owned] = tokenId;
          owned++;
        } catch {
          break;
        }
      }

      if (owned != balance) {
        uint256[] memory enumerated = new uint256[](owned);
        for (uint i = 0; i != owned; i++) {
          enumerated[i] = meta.nfts[i];
        }
        meta.nfts = enumerated;
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
  ) internal pure returns (NFTCollectionMetadata[] memory, address[] memory) {
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
    address[] memory deltaAddressesMapping = new address[](deltaSize);

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

    return (delta, deltaAddressesMapping);
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
    address[] memory deltaAddressesMapping = new address[](0);
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

      (afterSimulation.collections, deltaAddressesMapping) = getDelta(
        before.collections,
        afterSimulation.collections,
        collections
      );
    }

    return (before, afterSimulation, bytes(''), gasleft(), block.number, deltaAddressesMapping);
  }
}
