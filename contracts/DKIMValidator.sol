// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './Recoveries.sol';
import './dkim/RSASHA256.sol';
import './dkim/DKIM.sol';
import './libs/Strings.sol';
import './libs/SignatureValidator.sol';
import 'hardhat/console.sol';
import './dnssec/RRUtils.sol';

struct RRSetWithSignature {
    bytes rrset;
    bytes sig;
}

interface DnsSecOracle {
	function verifyRRSet(
        RRSetWithSignature[] memory input
    )
    external
    view
    returns (bytes memory rrs, uint32 inception);
}

contract DKIMValidator is ExternalSigValidator, Recoveries, DKIM {
    using Strings for *;
    using RRUtils for *;

    address dnsSecOracle;

    constructor(address _oracle) {
		dnsSecOracle = _oracle;
	}

    function validateSig(
        address accountAddr,
        bytes calldata data,
        bytes calldata sig,
        uint nonce,
        AmbireAccount.Transaction[] calldata calls
    ) external view returns (bool shouldExecute) {
        require(calls.length == 1, 'Too many txns');
        AmbireAccount.Transaction memory txn = calls[0];
        require(txn.to == accountAddr, 'Wrong address');

        (RecoveryInfo memory recoveryInfo, RRSetWithSignature[] memory rrSets) = abi.decode(data, (RecoveryInfo, RRSetWithSignature[]));
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

        // this is what we have in the headers from field:
        // from:Name Surname <email@provider.com>
        // we split from "from" to ">" and check if the email is
        // registered in account info
        Strings.slice memory headersSlice = canonizedHeaders.toSlice();
        headersSlice.splitNeedle('from:'.toSlice());
        Strings.slice memory afterSplit = headersSlice.splitNeedle('>'.toSlice());
        Strings.slice memory emailFrom = accountInfo.emailFrom.toSlice();
        if (! afterSplit.contains(emailFrom)) return false;

        // TO DO: validate to field and subject

        PublicKey memory publicKey = accountInfo.dkimKey.publicKey;

        // if the selectors don't match, perform DNSSEC validation
        if (keccak256(dkimSelector) != keccak256(accountInfo.dkimKey.keySelector)) {
            bool isDnsValid = dnsSecVerification(rrSets, accountInfo.domainIdentifier);
            if (! isDnsValid) return false;

            // TO DO: change the public key to the one after dnssec
        }

        bytes32 dkimHash = sha256(bytes(canonizedHeaders));
        bool verification = RSASHA256.verify(dkimHash, dkimSig, publicKey.exponent, publicKey.modulus);
        if (! verification) return false;

        //     const dateAdded = dkimKeys[keccak256(signature.dkimKey)]
        //     if (dateAdded == 0) {
        //     require(signature.rrSets.length > 0, 'no DNSSec proof and no valid DKIM key')
        //     dkimKey = addDKIMKeyWithDNSSec(signature.rrSets)
        //     } else {
        //     require(block.timestamp > dateAdded + accInfo.timelockForUnknownKeys, 'key added too recently, timelock not ready yet')
        //     dkimKey = signature.dkimKey
        //     }

        // confirm everything is signed with the recovery key
        bytes32 hash = keccak256(abi.encode(address(accountAddr), block.chainid, nonce, calls));
        address recoveryKey = SignatureValidator.recoverAddrImpl(hash, secondarySig, true);
        require(isIn(recoveryKey, recoveryInfo.keys), 'RecoverySig: not signed by the correct key');

        return true;
    }

    function isIn(address key, address[] memory keys) internal pure returns (bool) {
        for (uint256 i = 0; i < keys.length; i++) {
            if (key == keys[i]) return true;
        }
        return false;
    }

    function dnsSecVerification(
        RRSetWithSignature[] memory rrSets,
        bytes memory domainIdentifier
    ) internal view returns (bool) {
        if (rrSets.length == 0) return false;

        RRUtils.SignedSet memory rrset = rrSets[rrSets.length-1].rrset.readSignedSet();
        if (keccak256(rrset.signerName) != keccak256(domainIdentifier)) return false;

        (bytes memory rrs, ) = DnsSecOracle(dnsSecOracle).verifyRRSet(rrSets);
        return (keccak256(rrs) == keccak256(rrset.data));
    }

    function getDomainIdentifier(RRSetWithSignature memory set) public pure returns (bytes memory) {
        RRUtils.SignedSet memory rrset = set.rrset.readSignedSet();
        return rrset.signerName;
    }
}
