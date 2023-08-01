// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './Recoveries.sol';
import './dkim/RSASHA256.sol';
import './dkim/DKIM.sol';

contract DKIMValidator is ExternalSigValidator, Recoveries, DKIM {

    function validateSig(
        address accountAddr,
        bytes calldata data,
        bytes calldata sig,
        uint nonce,
        AmbireAccount.Transaction[] calldata calls
    ) external returns (bool shouldExecute) {

        // TO DO: CALCULATE THE HASH ONCHAIN
        // hash = sha256(join(canonizedHeaders.concat([hash(emailBody)])))

        (bytes memory selector, bytes memory dkimSig, address newKeyToSet, bytes memory headers) = abi.decode(sig, (bytes, bytes, address, bytes));
        AmbireAccount ambireAccount = AmbireAccount(payable(accountAddr));
        AmbireAccount.AccountInfo memory accountInfo = ambireAccount.getAccountInfo();
        bytes32 hash = sha256(headers);

        if (keccak256(selector) == keccak256(accountInfo.dkimKey.keySelector)) {
            return RSASHA256.verify(hash, dkimSig, accountInfo.dkimKey.publicKey.exponent, accountInfo.dkimKey.publicKey.modulus);

        //     const dateAdded = dkimKeys[keccak256(signature.dkimKey)]
        //     if (dateAdded == 0) {
        //     require(signature.rrSets.length > 0, 'no DNSSec proof and no valid DKIM key')
        //     dkimKey = addDKIMKeyWithDNSSec(signature.rrSets)
        //     } else {
        //     require(block.timestamp > dateAdded + accInfo.timelockForUnknownKeys, 'key added too recently, timelock not ready yet')
        //     dkimKey = signature.dkimKey
        //     }
        }

        return false;
    }
}
