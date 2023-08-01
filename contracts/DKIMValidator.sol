// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './Recoveries.sol';
import './dkim/RSASHA256.sol';
import './dkim/DKIM.sol';
import './libs/Strings.sol';
import './libs/SignatureValidator.sol';

contract DKIMValidator is ExternalSigValidator, Recoveries, DKIM {
    using Strings for *;

    function validateSig(
        address accountAddr,
        bytes calldata data,
        bytes calldata sig,
        uint nonce,
        AmbireAccount.Transaction[] calldata calls
    ) external returns (bool shouldExecute) {
        require(calls.length == 1, 'Too many txns');
        AmbireAccount.Transaction memory txn = calls[0];
        require(txn.to == accountAddr, 'Wrong address');

        (bytes memory dkimSelector, bytes memory dkimSig, bytes memory secondarySig, address newKeySigner, string memory canonizedHeaders) = abi.decode(sig, (bytes, bytes, bytes, address, string));

        // make sure the call data is trying to do setAddrPrivilege and to the correct key
        bytes memory functionData = abi.encodeWithSelector(
            AmbireAccount.setAddrPrivilege.selector,
            newKeySigner,
            bytes32(uint256(1))
        );
        require(keccak256(functionData) == keccak256(txn.data), 'Wrong calldata');

        AmbireAccount ambireAccount = AmbireAccount(payable(accountAddr));
        AmbireAccount.AccountInfo memory accountInfo = ambireAccount.getAccountInfo();
        if (keccak256(dkimSelector) == keccak256(accountInfo.dkimKey.keySelector)) {
            // this is what we have in the headers from field:
            // from:Name Surname <email@provider.com>
            // we split from "from" to ">" and check if the email is
            // registered in account info
            Strings.slice memory headersSlice = canonizedHeaders.toSlice();
            headersSlice.splitNeedle('from:'.toSlice());
            Strings.slice memory afterSplit = headersSlice.splitNeedle('>'.toSlice());
            if (! afterSplit.contains(accountInfo.emailFrom.toSlice())) return false;

            bytes32 hash = sha256(bytes(canonizedHeaders));
            bool verification = RSASHA256.verify(hash, dkimSig, accountInfo.dkimKey.publicKey.exponent, accountInfo.dkimKey.publicKey.modulus);
            if (! verification) return false;

        } else {
            // TO DO: WRITE THE CODE FOR DNSSEC

            //     const dateAdded = dkimKeys[keccak256(signature.dkimKey)]
            //     if (dateAdded == 0) {
            //     require(signature.rrSets.length > 0, 'no DNSSec proof and no valid DKIM key')
            //     dkimKey = addDKIMKeyWithDNSSec(signature.rrSets)
            //     } else {
            //     require(block.timestamp > dateAdded + accInfo.timelockForUnknownKeys, 'key added too recently, timelock not ready yet')
            //     dkimKey = signature.dkimKey
            //     }
        }

        // confirm everything is signed with the recovery key
        bytes32 hash = keccak256(abi.encode(address(accountAddr), block.chainid, nonce, calls));
        address recoveryKey = SignatureValidator.recoverAddrImpl(hash, secondarySig, true);
        (RecoveryInfo memory recoveryInfo) = abi.decode(data, (RecoveryInfo));
        require(isIn(recoveryKey, recoveryInfo.keys), 'RecoverySig: not signed by the correct key');

        return true;
    }

    function isIn(address key, address[] memory keys) internal pure returns (bool) {
        for (uint256 i = 0; i < keys.length; i++) {
            if (key == keys[i]) return true;
        }
        return false;
    }
}
