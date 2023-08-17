// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "../DKIMRecoverySigValidator.sol";

struct AccountInput {
    address addr;
    address[] associatedKeys;
    address factory;
    bytes factoryCalldata;
}

struct AccountInfo {
    bool isDeployed;
    uint nonce;
    bytes32[] associatedKeyPriviliges;
    bool isV2;
    uint256 balance;
    bool isEOA; 
}

contract AmbireAccountState {
    function getAccountsState(AccountInput[] memory accounts) external returns (AccountInfo[] memory accountResult) {
        accountResult = new AccountInfo[](accounts.length);
        for (uint i=0; i!=accounts.length; i++) {
            AccountInput memory account = accounts[i];
            accountResult[i].balance = address(account.addr).balance;
            // check for EOA
            if (account.factory == address(0)) {
                accountResult[i].isEOA = true;
                continue;
            }
            // is contract deployed
            if (address(account.addr).code.length > 0) {
                accountResult[i].isDeployed = true;
            } else {
                accountResult[i].isDeployed = false;
                // deploy contract to can check nonce and associatedKeys
                (bool success,) = account.factory.call(account.factoryCalldata);
                // we leave associateKeys empty and nonce == 0, so that the library can know that the deployment failed
                // we do not care about the exact error because this is a very rare case
                if (!success) continue;
            }
            accountResult[i].associatedKeyPriviliges = new bytes32[](account.associatedKeys.length);
            // get nonce - if contract is not deployed than nonce is zero
            accountResult[i].nonce = IAmbireAccount(account.addr).nonce();
            // get key privilege information
            for (uint j=0; j!=account.associatedKeys.length; j++) {
                accountResult[i].associatedKeyPriviliges[j] = IAmbireAccount(account.addr).privileges(account.associatedKeys[j]);
            }

            accountResult[i].isV2 = this.ambireV2Check(IAmbireAccount(account.addr));
        }
        return accountResult;
    }

    function ambireV2Check(IAmbireAccount account) external pure returns (bool) {
        return account.supportsInterface(0x150b7a02);
    }
}
