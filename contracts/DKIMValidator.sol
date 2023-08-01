// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './Recoveries.sol';
import './dkim/RSASHA256.sol';
import './dkim/DKIM.sol';
import 'hardhat/console.sol';
import './libs/Strings.sol';

contract DKIMValidator is ExternalSigValidator, Recoveries, DKIM {
    using Strings for *;

    function validateSig(
        address accountAddr,
        bytes calldata data,
        bytes calldata sig,
        uint nonce,
        AmbireAccount.Transaction[] calldata calls
    ) external returns (bool shouldExecute) {

        (bytes memory selector, bytes memory dkimSig, address newKeyToSet, string memory headers) = abi.decode(sig, (bytes, bytes, address, string));
        AmbireAccount ambireAccount = AmbireAccount(payable(accountAddr));
        AmbireAccount.AccountInfo memory accountInfo = ambireAccount.getAccountInfo();

        if (keccak256(selector) == keccak256(accountInfo.dkimKey.keySelector)) {
            // this is what we have in the headers from field:
            // from:Name Surname <email@provider.com>
            // we split from "from" to ">" and check if the email is
            // registered in account info
            Strings.slice memory headersSlice = headers.toSlice();
            headersSlice.splitNeedle('from:'.toSlice());
            Strings.slice memory afterSplit = headersSlice.splitNeedle('>'.toSlice());
            if (! afterSplit.contains(accountInfo.emailFrom.toSlice())) return false;

            bytes32 hash = sha256(bytes(headers));
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
