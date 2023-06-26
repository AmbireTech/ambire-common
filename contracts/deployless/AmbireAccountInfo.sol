// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./IAmbireAccount.sol";

struct Account {
    address addr;
    address[] associatedKeys;
    address factory;
    bytes factoryCalldata;
}

struct AssociatedKey {
    address key;
    bool privileges;
}

struct AccountInfo {
    address account;
    uint nonce;
    bool deployed;
    AssociatedKey[] associatedKeys;
}

struct SimulationOutcome {
    bool success;
    bytes err;
}

contract AmbireAccountInfo {

    function simulateDeployment(address factory, bytes memory factoryCalldata) public returns (SimulationOutcome memory outcome) {
        (outcome.success, outcome.err) = factory.call(factoryCalldata);
    }

    function getAccountsInfo(Account[] memory accounts) external returns (AccountInfo[] memory accountResult) {
        accountResult = new AccountInfo[](accounts.length);
        for (uint i=0; i!=accounts.length; i++) {
            accountResult[i].account = accounts[i].addr;
            accountResult[i].associatedKeys = new AssociatedKey[](accounts[i].associatedKeys.length);
            // is contract deployed
            if (address(accounts[i].addr).code.length > 0) {
                accountResult[i].deployed = true;
            } else {
                accountResult[i].deployed = false;
                // deploy contract to can check nonce and associatedKeys
                simulateDeployment(accounts[i].factory, accounts[i].factoryCalldata);
            }
            // get nonce - if contract is not deployed than nonce is zero
            accountResult[i].nonce = IAmbireAccount(accounts[i].addr).nonce();
            // get signer information
            for (uint j=0; j!=accountResult[i].associatedKeys.length; j++) {
                accountResult[i].associatedKeys[j].key = accounts[i].associatedKeys[j];
                if (IAmbireAccount(accounts[i].addr).privileges(accounts[i].associatedKeys[j]) != bytes32(0)) { 
                    accountResult[i].associatedKeys[j].privileges = true;
                } else {
                    accountResult[i].associatedKeys[j].privileges = false;
                }
            }
        }
        return accountResult;
    }
}