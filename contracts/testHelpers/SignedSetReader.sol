// SPDX-License-Identifier: agpl-3.0
// NOTE: we only support RSA-SHA256 DKIM signatures, this is why we do not have an algorithm field atm
// 
// This conctract is made only for testing purposes. It should not be used in production
// as it sets dkim keys in the constructor. It is conviniet for testing though.
pragma solidity 0.8.19;

import '../DKIMRecoverySigValidator.sol';
import '../dnssec/DNSSEC.sol';
import '../dnssec/RRUtils.sol';
import '../libs/Strings.sol';

contract SignedSetReader {
  using RRUtils for *;
  using Strings for *;

  function getDomainNameFromSignedSet(DNSSEC.RRSetWithSignature memory rrSet) public pure returns(string memory) {
    Strings.slice memory selector = string(rrSet.rrset.readSignedSet().data).toSlice();
    selector.rsplit(','.toSlice());
    return selector.toString();
  }
}