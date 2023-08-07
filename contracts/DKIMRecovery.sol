// NOTE: we only support RSA-SHA256 DKIM signatures, this is whhy we do not have an algorithm field atm

import './libs/IAmbireAccount.sol';
import './libs/SignatureValidator.sol';
import './dkim/RSASHA256.sol';

contract DKIMRecoverySigValidator {
  struct RRSetWithSignature {
      bytes rrset;
      bytes sig;
  }

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
  mapping dkimKeys (bytes32 => KeyInfo);
  // recoveryrIdentifier => bool
  mapping recoveries(bytes32 => bool);

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
    require(calls[0].data == abi.encodeWithSelector(IAmbireAccount.setAddrPrivilege.selector, sigMeta.newKeyToSet, sigMeta.newPrivilegeValue));

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
      for (uint i = 0; i != accInfo.canonizedHeaders.length; i++) {
        Strings.slice memory header = accInfo.canonizedHeaders[i].toSlice();
        canonizedHeadersBuffer = canonizedHeadersBuffer.concat(header);
        // @TODO must check if from is even present
        if (header.startsWith('from:'.toSlice())) {
          Strings.slice memory emailFrom = header.splitNeedle('>'.toSlice());
          emailFrom.splitNeedle('<'.toSlice());
          require(emailFrom.compare(accountInfo.emailFrom.toSlice()) == 0, 'emailFrom not valid');
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
      Strings.slice emailDomain = accInfo.emailFrom.toSlice();
      emailDomain.splitNeedle('@');
      string domainName = accInfo.dkimSelector.toSlice()
        .concat('._domainKey.'.toSlice())
        .concat(emailDomain)
        .toString();
      DKIMKey memory key = sigMeta.key;
      if (!(domainName == key.domainName && accInfo.dkimPubKeyExponent == key.pubKeyExponent && accInfo.dkimPubKeyModulus == key.pubKeyModulus)) {
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

      bytes32 dkimHash = sha256(bytes(canonizedHeadersBuffer.toString()));
      require(
        // @TODO our rsa key is not in this format
        RSASHA256.verify(dkimHash, dkimSig, key.pubKeyExponent, key.pubKeyModulus),
        'DKIM signature verification failed',
      )
    }

    if (sigMeta.mode == SigMode.Both || sigMeta.mode == SigMode.OnlySecond) {
      if (sigMeta.mode == SigMode.OnlySecond) require(accInfo.acceptEmptyDKIMSig, 'account disallows OnlySecond');
      // @TODO should spoofing be allowed
      require(
        SignatureValidator.recoverAddrImpl(hashToSign, secondSig, true) == accInfo.secondaryKey,
        'second key validation failed'
      );
    }

    // In those modes, we require a timelock
    if (sigMeta.mode == SigMode.OnlySecond || sigMeta.mode == OnlyDKIM) {
      bool shouldExecute = checkTimelock(identifier, onlyOneSigTimelock);
      if (!shouldExecute) return false;
    }

    recoveries[identifier] = true;
    return true;
  }

  function addDKIMKeyWithDNSSec(RRSetWithSignature[] rrSets, string txtRecord) returns (DKIMKey) {
    require(authorizedToSubmit == address(69) || msg.sender == authorizedToSubmit, 'not authorized to submit');
    require(DnsSecOracle(dnsSecOracle).verifyRRSet(rrSets), 'DNSSec verification failed');

    (DKIMKey key, string domainName) = parse(rrSets, txtRecord);
    bytes32 id = keccak256(key);

    KeyInfo storage keyInfo = dkimKeys[id];
    require(!keyInfo.isExisting, 'key already exists');

    keyInfo.isExisting = true;
    keyInfo.dateAdded = block.timestamp;
    if (String.endsWith(domainName, '.bridge.ambire.com')) {
      key.domainName = String.slice(domainName, 0, -'.bridge.ambire.com'.length);
      keyInfo.isBridge = true;
    }
  }

  function removeDKIMKey() {
    require(msg.sender == authorizedToRevoke);
    dkimKeys[id].dateRemoved = block.timestamp;
  }

  //
  // Timelock
  //
  struct Timelock {
    bool isExecuted;
    uint32 whenReady;
  }

  mapping (bytes32 => Timelock) timelocks;

  function checkTimelock(bytes32 identifier, uint32 time) returns (bool shouldExecute) {
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
