// SPDX-License-Identifier: agpl-3.0
// NOTE: we only support RSA-SHA256 DKIM signatures, this is why we do not have an algorithm field atm

import './libs/IAmbireAccount.sol';
import './libs/SignatureValidator.sol';
import './libs/Strings.sol';
import './dkim/RSASHA256.sol';
import './dnssec/DNSSEC.sol';
import './dnssec/RRUtils.sol';

contract DKIMRecoverySigValidator {
  using Strings for *;
  using RRUtils for *;

  struct DKIMKey {
    string domainName;
    bytes pubKeyModulus;
    bytes pubKeyExponent;
  }

  struct AccInfo {
    string emailFrom;
    string emailTo;
    // DKIM key
    // We have to additionally verify if it matches the domain in emailFrom
    string dkimSelector;
    bytes dkimPubKeyModulus;
    bytes dkimPubKeyExponent;
    // normally set to the email vault key held by the relayer
    address secondaryKey;
    // whether we accept selectors that are different from the one set in this struct
    bool acceptUnknownSelectors;
    // if a record has been added by `authorizedToSubmit`, we can choose to require some time to pass before accepting it
    uint32 waitUntilAcceptAdded;
    // if a record has been removed by the `authorizedToRemove`, we can choose to require some time to pass before accepting that ramoval
    uint32 waitUntilAcceptRemoved;
    // whether to accept any of those signatures to be missing; if only 1/2 sigs are provided we go into the timelock tho
    bool acceptEmptyDKIMSig;
    bool acceptEmptySecondSig;
    // The timelock in case we only use 1/2 signatures
    uint32 onlyOneSigTimelock;
  }

  // we need SigMode (OnlyDKIM, OnlySecond, Both) in the identifier itself, otherwise sigs are malleable (you can front-run a modified sig to trigger the timelock)
  // Known: no cancellation because 2/2 can immediately invalidate old timelock
  // @TODO sigMode has to go into the subject, otherwise there's a malleability 
  enum SigMode {
    Both,
    OnlyDKIM,
    OnlySecond
  }

  // the signatures themselves are passed separately to avoid cyclical dependency (`identifier` is generated from this meta)
  struct SignatureMeta {
    SigMode mode;
    DKIMKey key;
    string[] canonizedHeaders;
    address newKeyToSet;
    bytes32 newPrivilegeValue;
  }

  struct Key {
    string domainName;
    bytes pubKey;
  }

  struct KeyInfo {
    bool isExisting;
    bool isBridge;
    uint32 dateAdded;
    uint32 dateRemoved;
  }
  // keccak256(Key) => KeyInfo
  mapping (bytes32 => KeyInfo) dkimKeys;
  // recoveryrIdentifier => bool
  mapping (bytes32 => bool) recoveries;

  address authorizedToSubmit;
  address authorizedToRevoke;
  DNSSEC oracle;

  constructor(DNSSEC _oracle, address _authorizedToSubmit, address _authorizedToRevoke) {
    authorizedToSubmit = _authorizedToSubmit;
    authorizedToRevoke = _authorizedToRevoke;
    oracle = _oracle;
  }

  function validateSig(
    address accountAddr,
    bytes calldata data,
    bytes calldata sig,
    uint nonce,
    IAmbireAccount.Transaction[] calldata calls
  ) external returns (bool shouldExecute) {
    (AccInfo memory accInfo) = abi.decode(data, (AccInfo));
    (SignatureMeta memory sigMeta, bytes memory dkimSig, bytes memory secondSig) = abi.decode(sig, (SignatureMeta, bytes, bytes));
    bytes32 identifier = keccak256(abi.encode(accountAddr, accInfo, sigMeta));
    require(!recoveries[identifier], 'recovery already done');

    // Validate the calls: we only allow setAddrPrivilege for the pre-set newKeyToSet and newPrivilegeValue
    require(calls.length == 1, 'calls length must be 1');
    require(calls[0].value == 0, 'call value must be 0');
    require(calls[0].to == accountAddr, 'call to must be the account');
    require(keccak256(calls[0].data) == keccak256(abi.encodeWithSelector(IAmbireAccount.setAddrPrivilege.selector, sigMeta.newKeyToSet, sigMeta.newPrivilegeValue)));

    if (sigMeta.mode == SigMode.Both || sigMeta.mode == SigMode.OnlyDKIM) {
      if (sigMeta.mode == SigMode.OnlyDKIM) require(accInfo.acceptEmptySecondSig, 'account disallows OnlyDKIM');

      // @TODO parse canonizedHeaders, verify thge DKIM sig, verify the secondary sig, verify that .calls is correct (only one call to setAddrPrivilege with the newKeyToSet)
      // this is what we have in the headers from field:
      // from:Name Surname <email@provider.com>
      // we split from "from" to ">" and check if the email is
      // registered in account info
      // @TODO caninizedHeaders - we have to decide whether we use string[] and we join before hashing or just string and we split in order to parse
      Strings.slice memory canonizedHeadersBuffer;
      bool verifiedFrom;
      bool verifiedSubject;
      for (uint i = 0; i != sigMeta.canonizedHeaders.length; i++) {
        Strings.slice memory header = sigMeta.canonizedHeaders[i].toSlice();
        canonizedHeadersBuffer = canonizedHeadersBuffer.concat(header).toSlice();
        // @TODO must check if from is even present
        if (header.startsWith('from:'.toSlice())) {
          Strings.slice memory emailFrom = header.split('>'.toSlice());
          emailFrom.split('<'.toSlice());
          require(emailFrom.compare(accInfo.emailFrom.toSlice()) == 0, 'emailFrom not valid');
          verifiedFrom = true;
        }
        if (header.startsWith('subject:'.toSlice())) {
          // @TODO validate subject

        }
      }
      require(verifiedFrom && verifiedSubject, 'subject/from were not present');


      // After we've checked all headers and etc., we get the DKIM key we're using
      // @TODO is afterSplit correct here?
      //
      Strings.slice memory emailDomain = accInfo.emailFrom.toSlice();
      emailDomain.split('@'.toSlice());
      string memory domainName = accInfo.dkimSelector.toSlice()
        .concat('._domainKey.'.toSlice()).toSlice()
        .concat(emailDomain);

      DKIMKey memory key = sigMeta.key;
      if (! (
          keccak256(abi.encodePacked(domainName)) == keccak256(abi.encodePacked(key.domainName)) &&
          keccak256(accInfo.dkimPubKeyExponent) == keccak256(key.pubKeyExponent) &&
          keccak256(accInfo.dkimPubKeyModulus) == keccak256(key.pubKeyModulus)
        )) {
        bytes32 keyId = keccak256(abi.encode(sigMeta.key));
        // @TODO we need to validate sigMeta.key.domainName against the email from `from`:
        require(accInfo.acceptUnknownSelectors, 'account does not allow unknown selectors');
        KeyInfo storage keyInfo = dkimKeys[keyId];
        require(keyInfo.isExisting, 'non-existant DKIM key');
        require(keyInfo.dateRemoved == 0 || block.timestamp < keyInfo.dateRemoved + accInfo.waitUntilAcceptRemoved, 'DKIM key revoked');
        require(block.timestamp >= keyInfo.dateAdded + accInfo.waitUntilAcceptAdded, 'DKIM key not added yet');
      }

      // @TODO: VALIDATE TO FIELD
      // @TODO validate subject; this is one of the most important validations, as it will contain the `newKeyToSet`
      verify(canonizedHeadersBuffer, dkimSig, key);
    }

    bytes32 hashToSign;
    if (sigMeta.mode == SigMode.Both || sigMeta.mode == SigMode.OnlySecond) {
      if (sigMeta.mode == SigMode.OnlySecond) require(accInfo.acceptEmptyDKIMSig, 'account disallows OnlySecond');
        // @TODO should spoofing be allowed
        require(
          SignatureValidator.recoverAddrImpl(hashToSign, secondSig, true) == accInfo.secondaryKey,
          'second key validation failed'
        );
    }

    // In those modes, we require a timelock
    if (sigMeta.mode == SigMode.OnlySecond || sigMeta.mode == SigMode.OnlyDKIM) {
      bool shouldExecute = checkTimelock(identifier, accInfo.onlyOneSigTimelock);
      if (!shouldExecute) return false;
    }

    recoveries[identifier] = true;
    return true;
  }

  function addDKIMKeyWithDNSSec(DNSSEC.RRSetWithSignature[] memory rrSets, string memory txtRecord) public returns (DKIMKey memory) {
    require(authorizedToSubmit == address(69) || msg.sender == authorizedToSubmit, 'not authorized to submit');

    RRUtils.SignedSet memory rrset = rrSets[rrSets.length-1].rrset.readSignedSet();
    (bytes memory rrs, ) = oracle.verifyRRSet(rrSets);
    require(keccak256(rrs) == keccak256(rrset.data), 'DNSSec verification failed');

    (DKIMKey memory key, string memory domainName) = parse(rrSets, txtRecord);
    require(keccak256(rrset.signerName) != keccak256(abi.encodePacked(domainName)), 'DNSSec verification failed');

    // string domainName;
    // bytes pubKeyModulus;
    // bytes pubKeyExponent;
    bytes32 id = keccak256(abi.encode(key.domainName, key.pubKeyModulus, key.pubKeyExponent));

    KeyInfo storage keyInfo = dkimKeys[id];
    require(!keyInfo.isExisting, 'key already exists');

    keyInfo.isExisting = true;
    keyInfo.dateAdded = uint32(block.timestamp);
    Strings.slice memory bridgeString = '.bridge.ambire.com'.toSlice();
    if (domainName.toSlice().endsWith(bridgeString)) {
      // TODO: check if the below is correct
      key.domainName = domainName.toSlice().rsplit(bridgeString).toString();
      keyInfo.isBridge = true;
    }
  }

  function parse(DNSSEC.RRSetWithSignature[] memory rrSets, string memory txtRecord) internal returns (DKIMKey memory key, string memory domainName) {
    // TODO: create the parse function
  }

  function removeDKIMKey(bytes32 id) public {
    require(msg.sender == authorizedToRevoke);
    dkimKeys[id].dateRemoved = uint32(block.timestamp);
  }

  function verify(
    Strings.slice memory canonizedHeadersBuffer,
    bytes memory dkimSig,
    DKIMKey memory key
  ) internal returns (bool) {
    bytes32 dkimHash = sha256(bytes(canonizedHeadersBuffer.toString()));
    require(
      RSASHA256.verify(dkimHash, dkimSig, key.pubKeyExponent, key.pubKeyModulus),
      'DKIM signature verification failed'
    );
    return true;
  }

  //
  // Timelock
  //
  struct Timelock {
    bool isExecuted;
    uint32 whenReady;
  }

  mapping (bytes32 => Timelock) timelocks;

  function checkTimelock(bytes32 identifier, uint32 time) public returns (bool shouldExecute) {
    Timelock storage timelock = timelocks[identifier];
    require(!timelock.isExecuted, 'timelock: already executed');
    if (timelock.whenReady == 0) {
      timelock.whenReady = uint32(block.timestamp) + time;
      return false;
    } else {
      require(uint32(block.timestamp) >= timelock.whenReady, 'timelock: not ready yet');
      timelock.isExecuted = true;
      return true;
    }
  }
}
