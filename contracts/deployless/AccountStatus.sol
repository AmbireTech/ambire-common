// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./IAmbireAccount.sol";

contract AccountStatus {
  function getScheduledRecoveries(IAmbireAccount account, address[] memory associatedKeys, bytes32 privValue)
    public
    returns (uint[] memory scheduledRecoveries)
  {
    // Don't do this if we're not ambire v2
    try this.ambireV2Check(account) {}
    catch { return scheduledRecoveries; }

    // Check if there's a pending recovery that sets any of the associatedKeys
    scheduledRecoveries = new uint[](associatedKeys.length);
    uint currentNonce = account.nonce();
    for (uint i=0; i!=associatedKeys.length; i++) {
      address key = associatedKeys[i];
      IAmbireAccount.Transaction[] memory calls = new IAmbireAccount.Transaction[](1);
      calls[0].to = address(account);
      // @TODO the value of setAddrPrivilege is not necessarily 1 cause of the recovery
      calls[0].data = abi.encodeWithSelector(IAmbireAccount.setAddrPrivilege.selector, key, privValue);
      bytes32 hash = keccak256(abi.encode(address(account), block.chainid, currentNonce, calls));
      scheduledRecoveries[i] = account.scheduledRecoveries(hash);
    }
  }

  function ambireV2Check(IAmbireAccount account) external returns (uint) {
    return account.scheduledRecoveries(bytes32(0));
  }
}

