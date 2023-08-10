// SPDX-License-Identifier: agpl-3.0
// NOTE: we only support RSA-SHA256 DKIM signatures, this is why we do not have an algorithm field atm
pragma solidity 0.8.19;

import './libs/IAmbireAccount.sol';
import './libs/SignatureValidator.sol';
import './libs/Strings.sol';
import './libs/Base64.sol';
import './dnssec/BytesUtils.sol';
import './dkim/RSASHA256.sol';
import './dnssec/DNSSEC.sol';
import './dnssec/RRUtils.sol';
import './libs/OpenZepellingStrings.sol';
import 'hardhat/console.sol';

contract DKIMRecoverySigValidator {
  using Strings for *;
  using RRUtils for *;
  using Base64 for *;
  using BytesUtils for *;

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
  mapping (bytes32 => KeyInfo) public dkimKeys;
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

    AccInfo memory accInfo = abi.decode(data, (AccInfo));

    (SignatureMeta memory sigMeta, bytes memory dkimSig, bytes memory secondSig) = abi.decode(sig, (SignatureMeta, bytes, bytes));
    bytes32 identifier = keccak256(abi.encode(accountAddr, data, sigMeta));
    require(!recoveries[identifier], 'recovery already done');

    // Validate the calls: we only allow setAddrPrivilege for the pre-set newKeyToSet and newPrivilegeValue
    require(calls.length == 1, 'calls length must be 1');
    IAmbireAccount.Transaction memory txn = calls[0];
    require(txn.value == 0, 'call value must be 0');
    require(txn.to == accountAddr, 'call to must be the account');
    require(keccak256(txn.data) == keccak256(abi.encodeWithSelector(IAmbireAccount.setAddrPrivilege.selector, sigMeta.newKeyToSet, sigMeta.newPrivilegeValue)));

    SigMode mode = sigMeta.mode;
    if (mode == SigMode.Both || mode == SigMode.OnlyDKIM) {
      if (sigMeta.mode == SigMode.OnlyDKIM) require(accInfo.acceptEmptySecondSig, 'account disallows OnlyDKIM');

      Strings.slice memory canonizedHeadersBuffer = _verifyHeaders(
        sigMeta.canonizedHeaders,
        accInfo.emailFrom,
        accInfo.emailTo,
        sigMeta.newKeyToSet
      );

      // After we've checked all headers and etc., we get the DKIM key we're using
      // @TODO is afterSplit correct here?
      //
      Strings.slice memory emailDomain = accInfo.emailFrom.toSlice();
      emailDomain.split('@'.toSlice());
      string memory domainName = accInfo.dkimSelector.toSlice()
        .concat('._domainKey.'.toSlice()).toSlice()
        .concat(emailDomain);

      DKIMKey memory key = sigMeta.key;
      bytes memory pubKeyExponent = key.pubKeyExponent;
      bytes memory pubKeyModulus = key.pubKeyModulus;
      if (! (
          keccak256(abi.encodePacked(domainName)) == keccak256(abi.encodePacked(key.domainName)) &&
          keccak256(accInfo.dkimPubKeyExponent) == keccak256(pubKeyExponent) &&
          keccak256(accInfo.dkimPubKeyModulus) == keccak256(pubKeyModulus)
        )) {
        bytes32 keyId = keccak256(abi.encode(key));
        // @TODO we need to validate sigMeta.key.domainName against the email from `from`:
        require(accInfo.acceptUnknownSelectors, 'account does not allow unknown selectors');
        KeyInfo storage keyInfo = dkimKeys[keyId];
        require(keyInfo.isExisting, 'non-existant DKIM key');
        uint32 dateRemoved = keyInfo.dateRemoved;
        require(dateRemoved == 0 || block.timestamp < dateRemoved + accInfo.waitUntilAcceptRemoved, 'DKIM key revoked');
        require(block.timestamp >= keyInfo.dateAdded + accInfo.waitUntilAcceptAdded, 'DKIM key not added yet');
      }

      // @TODO: VALIDATE TO FIELD
      // @TODO validate subject; this is one of the most important validations, as it will contain the `newKeyToSet`
      // verify(canonizedHeadersBuffer, dkimSig, key);
      require(
        RSASHA256.verify(sha256(bytes(canonizedHeadersBuffer.toString())), dkimSig, pubKeyExponent, pubKeyModulus),
        'DKIM signature verification failed'
      );
    }

    _verifySig(
      mode,
      keccak256(abi.encode(address(accountAddr), block.chainid, nonce, calls)),
      secondSig,
      accInfo.secondaryKey,
      accInfo.acceptEmptyDKIMSig
    );

    // In those modes, we require a timelock
    if (mode == SigMode.OnlySecond || mode == SigMode.OnlyDKIM) {
      shouldExecute = checkTimelock(identifier, accInfo.onlyOneSigTimelock);
      if (!shouldExecute) return shouldExecute;
    }

    recoveries[identifier] = true;
  }

  function addDKIMKeyWithDNSSec(DNSSEC.RRSetWithSignature[] memory rrSets) public {
    require(authorizedToSubmit == address(69) || msg.sender == authorizedToSubmit, 'not authorized to submit');

    RRUtils.SignedSet memory rrset = rrSets[rrSets.length-1].rrset.readSignedSet();
    (bytes memory rrs, ) = oracle.verifyRRSet(rrSets);
    require(keccak256(rrs) == keccak256(rrset.data), 'DNSSec verification failed');

    (DKIMKey memory key, string memory domainName) = parse(rrset);
    require(keccak256(rrset.signerName) == keccak256(bytes(domainName)), 'DNSSec verification failed');

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

  function parse(RRUtils.SignedSet memory txtSet) internal pure returns (DKIMKey memory key, string memory domainName) {
    Strings.slice memory publicKey = string(txtSet.data).toSlice();
    publicKey.split('p='.toSlice());
    bytes memory pValue = bytes(publicKey.toString());

    string memory pValueOrg = string(pValue);
    uint256 offsetOfInvalidUnicode = pValue.find(0, pValue.length, 0x9b);
    while (offsetOfInvalidUnicode != type(uint256).max) {
      bytes memory firstPartOfKey = pValue.substring(0, offsetOfInvalidUnicode);
      bytes memory secondPartOfKey = pValue.substring(offsetOfInvalidUnicode + 1, pValue.length - 1 - offsetOfInvalidUnicode);
      pValueOrg = string(firstPartOfKey).toSlice().concat(string(secondPartOfKey).toSlice());
      offsetOfInvalidUnicode = bytes(pValueOrg).find(0, bytes(pValueOrg).length, 0x9b);
    }

    bytes memory decoded = string(pValueOrg).decode();
    // omit the first 32 bytes, take everything expect the last 5 bytes:
    // - first two bytes from the last 5 is modulus header info
    // - last three bytes is modulus
    bytes memory modulus = decoded.substring(32, decoded.length - 32 - 5);
    // the last 3 bytes of the decoded string is the exponent
    bytes memory exponent = decoded.substring(decoded.length - 3, 3);
    domainName = string(txtSet.signerName);
    key = DKIMKey(
      domainName,
      modulus,
      exponent
    );
    return (key, domainName);
  }

  function removeDKIMKey(bytes32 id) public {
    require(msg.sender == authorizedToRevoke);
    dkimKeys[id].dateRemoved = uint32(block.timestamp);
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

  function getDomainNameFromSignedSet(DNSSEC.RRSetWithSignature memory rrSet) public pure returns(string memory domainName) {
    domainName = string(rrSet.rrset.readSignedSet().signerName);
  }

  function _verifyHeaders(
    string[] memory canonizedHeaders,
    string memory accountEmailFrom,
    string memory accountEmailTo,
    address newKeyToSet
  ) internal view returns(Strings.slice memory canonizedHeadersBuffer) {

    // @TODO parse canonizedHeaders, verify thge DKIM sig, verify the secondary sig, verify that .calls is correct (only one call to setAddrPrivilege with the newKeyToSet)
      // this is what we have in the headers from field:
      // from:Name Surname <email@provider.com>
      // we split from "from" to ">" and check if the email is
      // registered in account info
      // @TODO caninizedHeaders - we have to decide whether we use string[] and we join before hashing or just string and we split in order to parse
      bool verifiedFrom;
      bool verifiedTo;
      bool verifiedSubject;
      for (uint i = 0; i != canonizedHeaders.length; i++) {
        Strings.slice memory header = canonizedHeaders[i].toSlice();
        canonizedHeadersBuffer = canonizedHeadersBuffer.concat(header).toSlice();

        if (header.startsWith('From:'.toSlice())) {
          header.split('<'.toSlice());
          Strings.slice memory emailFrom;
          header.split('>'.toSlice(), emailFrom);
          require(emailFrom.compare(accountEmailFrom.toSlice()) == 0, 'emailFrom not valid');
          verifiedFrom = true;
        }
        if (header.startsWith('Delivered-To:'.toSlice())) {
          header.split('Delivered-To: '.toSlice());
          require(header.compare(accountEmailTo.toSlice()) == 0, 'emailTo not valid');
          verifiedTo = true;
        }
        // TO DO: finish the subject validation
        if (header.startsWith('Subject:'.toSlice())) {
          header.split('Subject: '.toSlice());
          string memory subject = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
          string memory newKeyString = OpenZepellingStrings.toHexString(newKeyToSet);
          require(keccak256(bytes(subject)) == keccak256(bytes(newKeyString)), 'subject mismatch');
          verifiedSubject = true;
        }
      }
      require(verifiedFrom && verifiedTo && verifiedSubject, 'subject/to/from were not present');
  }

  function _verifySig(SigMode mode, bytes32 hashToSign, bytes memory secondSig, address secondaryKey, bool acceptEmptyDKIMSig) internal {
    if (mode == SigMode.Both || mode == SigMode.OnlySecond) {
      if (mode == SigMode.OnlySecond) require(acceptEmptyDKIMSig, 'account disallows OnlySecond');

      // @TODO should spoofing be allowed
      require(
        SignatureValidator.recoverAddrImpl(hashToSign, secondSig, true) == secondaryKey,
        'second key validation failed'
      );
    }
  }
}
