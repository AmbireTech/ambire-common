// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

import './Spoof.sol';
import '../libs/Transaction.sol';

contract Simulation is Spoof {
  struct ToSimulate {
    uint nonce;
    Transaction[] txns;
  }

  function simulate(
    IAmbireAccount account,
    address[] memory associatedKeys,
    address factory,
    bytes memory factoryCalldata,
    ToSimulate[] calldata toSimulate
  ) public returns (uint startingNonce, bool, bytes memory) {
    if (address(account).code.length == 0) {
      (bool success, bytes memory err) = factory.call(factoryCalldata);
      if (!success) return (0, false, err);
    }

    startingNonce = account.nonce();
    for (uint256 i = 0; i < toSimulate.length; i++) {
      if (account.nonce() == toSimulate[i].nonce) {
        try this.getSpoof(account, associatedKeys) returns (bytes memory spoofSig) {
          try account.execute(toSimulate[i].txns, spoofSig) {} catch (bytes memory err) {
            return (startingNonce, false, err);
          }
        } catch (bytes memory spoofErr) {
          return (startingNonce, false, spoofErr);
        }
      }
    }

    return (startingNonce, true, bytes(''));
  }
}
