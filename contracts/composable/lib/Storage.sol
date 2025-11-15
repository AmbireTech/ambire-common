// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title Storage
 * @dev Contract to handle generic storage operations with cross-chain support
 */
contract Storage {
  error SlotNotInitialized();

  // Mapping to track initialized slots
  mapping(bytes32 => bool) private initializedSlots;

  // Mapping to track length of dynamic data
  mapping(bytes32 => uint256) private dynamicDataLength;

  /**
   * @dev Internal function to write a value to a specific storage slot
   */
  function _writeStorage(bytes32 slot, bytes32 value, bytes32 namespace) private {
    bytes32 namespacedSlot = getNamespacedSlot(namespace, slot);
    initializedSlots[namespacedSlot] = true;
    assembly {
      sstore(namespacedSlot, value)
    }
  }

  /**
   * @dev Write a value to a specific storage slot
   * @param slot The storage slot to write to
   * @param value The value to write
   */
  function writeStorage(bytes32 slot, bytes32 value, address account) external {
    bytes32 namespace = getNamespace(account, msg.sender);
    _writeStorage(slot, value, namespace);
  }

  /**
   * @dev Read a value from a specific namespace and slot
   * @param namespace The namespace (typically a contract address)
   * @param slot The storage slot to read from
   * @return The value stored at the specified namespaced slot
   */
  function readStorage(bytes32 namespace, bytes32 slot) external view returns (bytes32) {
    bytes32 namespacedSlot = getNamespacedSlot(namespace, slot);
    if (!initializedSlots[namespacedSlot]) {
      revert SlotNotInitialized();
    }
    bytes32 value;
    assembly {
      value := sload(namespacedSlot)
    }
    return value;
  }

  /**
   * @dev Generates a namespaced slot
   * @param namespace The namespace (typically a contract address)
   * @param slot The storage slot to read from
   * @return The namespaced slot
   */
  function getNamespacedSlot(bytes32 namespace, bytes32 slot) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(namespace, slot));
  }

  /**
   * @dev Generates a namespace for a given account and caller
   * @param account The account address
   * @param caller The caller address
   * @return The generated namespace
   */
  function getNamespace(address account, address caller) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(account, caller));
  }

  /**
   * @dev Check if a slot has been initialized
   */
  function isSlotInitialized(bytes32 namespace, bytes32 slot) external view returns (bool) {
    bytes32 namespacedSlot = getNamespacedSlot(namespace, slot);
    return initializedSlots[namespacedSlot];
  }
}
