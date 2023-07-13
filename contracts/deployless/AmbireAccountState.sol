// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./IAmbireAccount.sol";

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
}

contract AmbireAccountState {
    function getAccountsState(AccountInput[] memory accounts) external returns (AccountInfo[] memory accountResult) {
        accountResult = new AccountInfo[](accounts.length);
        for (uint i=0; i!=accounts.length; i++) {
            AccountInput memory account = accounts[i];
            // is contract deployed
            if (address(accounts[i].addr).code.length > 0) {
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
        }
        return accountResult;
    }

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
