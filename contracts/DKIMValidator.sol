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

        (bytes memory selector, PublicKey memory publicKey, bytes memory dkimSig, address newKeyToSet, bytes32 hash) = abi.decode(sig, (bytes, PublicKey, bytes, address, bytes32));

        AmbireAccount ambireAccount = AmbireAccount(payable(accountAddr));
        if (keccak256(selector) == keccak256(ambireAccount.getDKIMKey().keySelector)) {
            return RSASHA256.verify(hash, dkimSig, publicKey.exponent, publicKey.modulus);

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
