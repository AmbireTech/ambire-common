// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import './IAmbireAccount.sol';
import './MetaFlags.sol';
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
  struct NFTCollectionInfo {
    string name;
    string symbol;
    uint256[] nfts;
    bytes error;
  }
  struct NFTCollectionBalance {
    uint256[] nfts;
    bytes error;
  }
  struct NFTCollectionMeta {
    string name;
    string symbol;
  }
  struct NFTCollectionAtNonce {
    NFTCollectionBalance[] collections;
    uint nonce;
  }

  function getCollectionInfo(
    IAmbireAccount account,
    NFT collection,
    uint[] memory tokenIds,
    uint limit,
    bool withMeta
  ) external view returns (NFTCollectionInfo memory info) {
    if (withMeta) {
      info.name = collection.name();
      info.symbol = collection.symbol();
    }

    uint balance = collection.balanceOf(address(account));
    if (balance > limit) balance = limit;
    info.nfts = new uint256[](balance);

    bool isEnumerable = collection.supportsInterface(0x780e9d63);

    if (isEnumerable || tokenIds.length == 0) {
      for (uint i = 0; i != balance; i++) {
        uint tokenId = collection.tokenOfOwnerByIndex(address(account), i);
        info.nfts[i] = tokenId;
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
      info.nfts = new uint256[](total);
      uint j = 0;
      for (uint i = 0; i != tokenIds.length; i++) {
        try collection.ownerOf(tokenIds[i]) returns (address ownerOfCurrentToken) {
          if (ownerOfCurrentToken == address(account)) {
            info.nfts[j] = tokenIds[i];
            j++;
          }
        } catch {}
      }
    }
  }

  // Token ids for every collection, metadata for the ones metaFlags points at. A single
  // call per collection reads both, so asking for metadata costs no extra call and no
  // extra gas allowance.
  function getAllNFTs(
    IAmbireAccount account,
    NFT[] memory collections,
    uint[][] memory tokenIds,
    uint tokenPerCollectionLimit,
    // Passing a second array of addresses makes the call more expensive, so we use a single array of flags instead.
    bytes memory metaFlags
  ) public view returns (NFTCollectionBalance[] memory, NFTCollectionMeta[] memory) {
    uint len = collections.length;
    NFTCollectionBalance[] memory balances = new NFTCollectionBalance[](len);
    NFTCollectionMeta[] memory metas = new NFTCollectionMeta[](MetaFlags.count(metaFlags, len));
    uint metaIndex = 0;

    for (uint i = 0; i != len; i++) {
      bool withMeta = MetaFlags.has(metaFlags, i);

      try
        this.getCollectionInfo{ gas: 50000 * tokenPerCollectionLimit }(
          account,
          collections[i],
          tokenIds[i],
          tokenPerCollectionLimit,
          withMeta
        )
      returns (NFTCollectionInfo memory info) {
        balances[i].nfts = info.nfts;
        if (withMeta) {
          metas[metaIndex] = NFTCollectionMeta(info.name, info.symbol);
          metaIndex++;
        }
      } catch (bytes memory err) {
        balances[i].error = err.length == 0 ? bytes('REVERT') : err;
        // The entry is left empty, the caller reads the error off the token ids
        if (withMeta) metaIndex++;
      }
    }

    return (balances, metas);
  }

  // Compare the collections before (collectionsA) and after simulation (collectionsB)
  // and return the delta (with simulation)
  function getDelta(
    NFTCollectionBalance[] memory collectionsA,
    NFTCollectionBalance[] memory collectionsB,
    NFT[] memory collections
  ) internal pure returns (NFTCollectionBalance[] memory, address[] memory) {
    uint deltaSize = 0;

    for (uint256 i = 0; i < collectionsA.length; i++) {
      // Compare hashes of the arrays
      bytes32 hashA = keccak256(abi.encode(collectionsA[i].nfts));
      bytes32 hashB = keccak256(abi.encode(collectionsB[i].nfts));
      if (hashA != hashB) {
        deltaSize++;
      }
    }

    NFTCollectionBalance[] memory delta = new NFTCollectionBalance[](deltaSize);
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
    bytes memory metaFlags,
    // instead of passing {factory, code, salt}, we'll just have factory and factoryCalldata
    address factory,
    bytes memory factoryCalldata,
    Simulation.ToSimulate[] calldata toSimulate
  )
    external
    returns (
      NFTCollectionAtNonce memory before,
      NFTCollectionAtNonce memory afterSimulation,
      NFTCollectionMeta[] memory metas,
      bytes memory /*simulationError*/,
      uint /*gasLeft*/,
      uint /*blockNum*/,
      address[] memory // deltaAddressesMapping
    )
  {
    address[] memory deltaAddressesMapping = new address[](0);
    (before.collections, metas) = getAllNFTs(
      account,
      collections,
      tokenIds,
      tokenPerCollectionLimit,
      metaFlags
    );

    (uint startNonce, bool success, bytes memory err) = Simulation.simulate(
      account,
      associatedKeys,
      factory,
      factoryCalldata,
      toSimulate
    );
    before.nonce = startNonce;

    if (!success) {
      return (before, afterSimulation, metas, err, gasleft(), block.number, deltaAddressesMapping);
    }

    afterSimulation.nonce = account.nonce();
    if (afterSimulation.nonce != before.nonce) {
      // the metadata cannot change mid-simulation, so only the token ids are read again
      (NFTCollectionBalance[] memory collectionsAfter, ) = getAllNFTs(
        account,
        collections,
        tokenIds,
        tokenPerCollectionLimit,
        bytes('')
      );

      (afterSimulation.collections, deltaAddressesMapping) = getDelta(
        before.collections,
        collectionsAfter,
        collections
      );
    }

    return (
      before,
      afterSimulation,
      metas,
      bytes(''),
      gasleft(),
      block.number,
      deltaAddressesMapping
    );
  }
}
