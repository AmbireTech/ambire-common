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
    bytes32[] associatedKeyPrivileges;
    bool isV2;
    uint256 balance;
    bool isEOA;
    uint erc4337Nonce;
    uint currentBlock;
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
                if (!success || address(account.addr).code.length == 0) {
                    accountResult[i].deployErr = bytes(success ? "call worked" : "call failed");
                    continue;
                }
            }
            try this.gatherAmbireData(account) returns (uint nonce, bytes32[] memory privileges, bool isV2, uint erc4337Nonce) {
                accountResult[i].nonce = nonce;
                accountResult[i].associatedKeyPrivileges = privileges;
                accountResult[i].isV2 = isV2;
                accountResult[i].erc4337Nonce = erc4337Nonce;
            } catch (bytes memory err) {
                accountResult[i].deployErr = err;
                continue;
            }

            accountResult[i].currentBlock = block.number;
        }
        return accountResult;
    }

    function gatherAmbireData(AccountInput memory account) external returns (uint nonce, bytes32[] memory privileges, bool isV2, uint erc4337Nonce ) {
        privileges = new bytes32[](account.associatedKeys.length);
        isV2 = this.ambireV2Check(IAmbireAccount(account.addr));
        for (uint j=0; j!=account.associatedKeys.length; j++) {
            privileges[j] = IAmbireAccount(account.addr).privileges(account.associatedKeys[j]);
        }
        nonce = IAmbireAccount(account.addr).nonce();

        try this.getErc4337Nonce(account.addr, account.erc4337EntryPoint) returns (uint aaNonce) {
            erc4337Nonce = aaNonce;
        } catch (bytes memory) {
            erc4337Nonce = type(uint256).max;
        }
    }

    function getErc4337Nonce(address acc, address entryPoint) external returns (uint) {
        return IEntryPoint(entryPoint).getNonce(acc, 0);
    }

    function ambireV2Check(IAmbireAccount account) external view returns(bool) {
        return account.supportsInterface(0x0a417632) || account.supportsInterface(0x150b7a02);
    }
}