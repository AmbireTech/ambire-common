// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './Recoveries.sol';
import './dkim/RSASHA256.sol';

contract DKIMValidator is ExternalSigValidator, Recoveries {

    struct RSAPK {
        bytes exponent;
        bytes modulus;
    }

    struct DKIMKey {
        bytes selector;
        RSAPK publicKey;
    }

    function validateSig(
        address accountAddr,
        bytes calldata data,
        bytes calldata sig,
        uint nonce,
        AmbireAccount.Transaction[] calldata calls
    ) external returns (bool shouldExecute) {

        (DKIMKey memory key, bytes memory dkimSig, address newKeyToSet) = abi.decode(sig, (DKIMKey, bytes, address));
        bytes32 hash = keccak256(abi.encode(nonce));
        return RSASHA256.verify(hash, dkimSig, key.publicKey.exponent, key.publicKey.modulus);

        // call the verifier and verify, that's it.
        // DKIMKey dkimKey = accInfo.dkimKey;
        // if (signature.dkimKey.selector !== dkimKey.selector) {
        //     const dateAdded = dkimKeys[keccak256(signature.dkimKey)]
        //     if (dateAdded == 0) {
        //     require(signature.rrSets.length > 0, 'no DNSSec proof and no valid DKIM key')
        //     dkimKey = addDKIMKeyWithDNSSec(signature.rrSets)
        //     } else {
        //     require(block.timestamp > dateAdded + accInfo.timelockForUnknownKeys, 'key added too recently, timelock not ready yet')
        //     dkimKey = signature.dkimKey
        //     }
        // }
    }
}
