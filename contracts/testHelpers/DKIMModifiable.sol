// SPDX-License-Identifier: agpl-3.0
// NOTE: we only support RSA-SHA256 DKIM signatures, this is why we do not have an algorithm field atm
// 
// This conctract is made only for testing purposes. It should not be used in production
// as it sets dkim keys in the constructor. It is conviniet for testing though.
pragma solidity 0.8.19;

import '../DKIMRecoverySigValidator.sol';
import '../dkim/DNSSEC.sol';

contract DKIMModifiable is DKIMRecoverySigValidator {
    constructor(
        DKIMRecoverySigValidator.DKIMKey[] memory keys,
        uint32[] memory waitTimestamps,
        DNSSEC _oracle,
        address _authorizedToSubmit,
        address _authorizedToRevoke
    )
    DKIMRecoverySigValidator(_oracle, _authorizedToSubmit, _authorizedToRevoke) {
        // set DKIM keys to help with testing
        for (uint i=0; i<keys.length; i++) {
            bytes32 keyId = keccak256(abi.encode(keys[i]));
            dkimKeys[keyId] = KeyInfo(true, false, uint32(block.timestamp) + waitTimestamps[i], uint32(0));
        }
    }
}