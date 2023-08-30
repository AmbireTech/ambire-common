// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./IAmbireAccount.sol";

interface IEntryPoint {
    function getNonce(address, uint192) external returns (uint);
}

struct AccountInput {
    address addr;
    address[] associatedKeys;
    address factory;
    bytes factoryCalldata;
    address erc4337EntryPoint;
}

struct AccountInfo {
    bool isDeployed;
    bytes deployErr;
    uint nonce;
    bytes32[] associatedKeyPriviliges;
    bool isV2;
    uint256 balance;
    bool isEOA;
    bool isErc4337Enabled;
    bool isErc4337Nonce;
}

contract AmbireAccountState {
    
    bytes32 constant ENTRY_POINT_PRIV = 0x42144640c7cb5ff8aa9595ae175ffcb6dd152db6e737c13cc2d5d07576967020;

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
                if (!success || address(account.addr).code.length == 0) {
                    accountResult[i].deployErr = bytes(success ? "call worked" : "call failed");
                    continue;
                }
            }
            try this.gatherAmbireData(account) returns (uint nonce, bytes32[] memory privileges, bool isV2, bool isErc4337Enabled, bool isErc4337Nonce) {
                accountResult[i].nonce = nonce;
                accountResult[i].associatedKeyPriviliges = privileges;
                accountResult[i].isV2 = isV2;
                accountResult[i].isErc4337Enabled = isErc4337Enabled;
                accountResult[i].isErc4337Nonce = isErc4337Nonce;
            } catch (bytes memory err) {
                accountResult[i].deployErr = err;
                continue;
            }
        }
        return accountResult;
    }

    function gatherAmbireData(AccountInput memory account) external returns (uint nonce, bytes32[] memory privileges, bool isV2, bool isErc4337Enabled, bool isErc4337Nonce) {
        address entryPointAddr = account.erc4337EntryPoint;
        isErc4337Nonce = false;
        isErc4337Enabled = false;
        privileges = new bytes32[](account.associatedKeys.length);
        isV2 = this.ambireV2Check(IAmbireAccount(account.addr));
        for (uint j=0; j!=account.associatedKeys.length; j++) {
            privileges[j] = IAmbireAccount(account.addr).privileges(account.associatedKeys[j]);
            if (account.associatedKeys[j] == entryPointAddr && privileges[j] != bytes32(0)) isErc4337Enabled = true;
        }
        if (entryPointAddr == address(0)) {
            nonce =  IAmbireAccount(account.addr).nonce();
        } else {
            nonce = IEntryPoint(entryPointAddr).getNonce(account.addr, 0);
            isErc4337Nonce = true;
        }
    }

    function ambireV2Check(IAmbireAccount account) external pure returns(bool) {
        return account.supportsInterface(0x0a417632) || account.supportsInterface(0x150b7a02);
    }
}