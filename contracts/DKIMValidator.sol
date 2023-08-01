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

        // TO DO: CALCULATE THE HASH ONCHAIN
        // hash = sha256(join(canonizedHeaders.concat([hash(emailBody)])))

        // plan...
        // receive the headers as a string
        // get the email-to or smt
        // check if it's the same as the one in account info

        (bytes memory selector, bytes memory dkimSig, address newKeyToSet, string memory headers) = abi.decode(sig, (bytes, bytes, address, string));
        AmbireAccount ambireAccount = AmbireAccount(payable(accountAddr));
        AmbireAccount.AccountInfo memory accountInfo = ambireAccount.getAccountInfo();

        Strings.slice memory headersSlice = headers.toSlice();
        Strings.slice memory to = 'from:YouTube <no-reply@youtube.com>'.toSlice();
        require(headersSlice.contains(to), 'No such from address');

        bytes32 hash = sha256(bytes(headers));
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
