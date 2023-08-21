// SPDX-License-Identifier: agpl-3.0
// NOTE: we only support RSA-SHA256 DKIM signatures, this is why we do not have an algorithm field atm
pragma solidity 0.8.19;

import './deployless/IAmbireAccount.sol';
import './libs/SignatureValidator.sol';
import './libs/Strings.sol';
import './libs/Base64.sol';
import "./libs/BytesUtils.sol";
import './dkim/RSASHA256.sol';
import './dkim/DNSSEC.sol';
import './dkim/RRUtils.sol';
import './libs/OpenZepellingStrings.sol';

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
    string domainName;
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
  enum SigMode {
    Both,
    OnlyDKIM,
    OnlySecond
  }

  // the signatures themselves are passed separately to avoid cyclical dependency (`identifier` is generated from this meta)
  struct SignatureMeta {
    SigMode mode;
    DKIMKey key;
    string canonizedHeaders;
    address newKeyToSet;
    bytes32 newPrivilegeValue;
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
  mapping (bytes32 => bool) public recoveries;

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
    uint,
    IAmbireAccount.Transaction[] calldata calls
  ) external returns (bool) {

    AccInfo memory accInfo = abi.decode(data, (AccInfo));

    (SignatureMeta memory sigMeta, bytes memory dkimSig, bytes memory secondSig) = abi.decode(sig, (SignatureMeta, bytes, bytes));
    bytes32 identifier = keccak256(abi.encode(accountAddr, data, sigMeta));
    require(!recoveries[identifier], 'recovery already done');

    // Validate the calls: we only allow setAddrPrivilege for the pre-set newKeyToSet and newPrivilegeValue
    require(calls.length == 1, 'calls length must be 1');
    IAmbireAccount.Transaction memory txn = calls[0];
    require(txn.value == 0, 'call value must be 0');
    require(txn.to == accountAddr, 'call "to" must be the ambire account addr');
    require(keccak256(txn.data) == keccak256(abi.encodeWithSelector(IAmbireAccount.setAddrPrivilege.selector, sigMeta.newKeyToSet, sigMeta.newPrivilegeValue)), 'Transaction data is not set correctly, either selector, key or priv is incorrect');

    SigMode mode = sigMeta.mode;
    if (mode == SigMode.Both || mode == SigMode.OnlyDKIM) {
      if (sigMeta.mode == SigMode.OnlyDKIM) require(accInfo.acceptEmptySecondSig, 'account disallows OnlyDKIM');

      string memory headers = sigMeta.canonizedHeaders;
      _verifyHeaders(
        headers,
        accInfo.emailFrom,
        accInfo.emailTo,
        sigMeta.newKeyToSet,
        sigMeta.mode
      );

      DKIMKey memory key = sigMeta.key;
      bytes memory pubKeyExponent = key.pubKeyExponent;
      bytes memory pubKeyModulus = key.pubKeyModulus;
      if (! (
          keccak256(abi.encodePacked(accInfo.domainName)) == keccak256(abi.encodePacked(key.domainName)) &&
          keccak256(accInfo.dkimPubKeyExponent) == keccak256(pubKeyExponent) &&
          keccak256(accInfo.dkimPubKeyModulus) == keccak256(pubKeyModulus)
        )) {

        Strings.slice memory emailDomain = accInfo.domainName.toSlice();
        emailDomain.split('_domainkey'.toSlice());
        require(bytes(emailDomain.toString()).length > 0 && key.domainName.toSlice().endsWith(emailDomain), 'domain in sigMeta is not authorized for this account');

        bytes32 keyId = keccak256(abi.encode(key));
        require(accInfo.acceptUnknownSelectors, 'account does not allow unknown selectors');
        KeyInfo storage keyInfo = dkimKeys[keyId];
        require(keyInfo.isExisting, 'non-existant DKIM key');
        uint32 dateRemoved = keyInfo.dateRemoved;
        require(dateRemoved == 0 || block.timestamp < dateRemoved + accInfo.waitUntilAcceptRemoved, 'DKIM key revoked');
        require(block.timestamp >= keyInfo.dateAdded + accInfo.waitUntilAcceptAdded, 'DKIM key not added yet');
      }

      require(
        RSASHA256.verify(sha256(bytes(headers)), dkimSig, pubKeyExponent, pubKeyModulus),
        'DKIM signature verification failed'
      );
    }

    bytes32 hashToSign = keccak256(abi.encode(address(accountAddr), calls));
    if (mode == SigMode.Both || mode == SigMode.OnlySecond) {
      if (mode == SigMode.OnlySecond) require(accInfo.acceptEmptyDKIMSig, 'account disallows OnlySecond');

      // @TODO should spoofing be allowed
      require(
        SignatureValidator.recoverAddrImpl(hashToSign, secondSig, true) == accInfo.secondaryKey,
        'second key validation failed'
      );
    }

    // In those modes, we require a timelock
    if (mode == SigMode.OnlySecond || mode == SigMode.OnlyDKIM) {
      if (! checkTimelock(identifier, accInfo.onlyOneSigTimelock)) {
        return false;
      }
    }

    recoveries[identifier] = true;
    return true;
  }

  function addDKIMKeyWithDNSSec(DNSSEC.RRSetWithSignature[] memory rrSets) public {
    require(authorizedToSubmit == address(69) || msg.sender == authorizedToSubmit, 'not authorized to submit');

    RRUtils.SignedSet memory rrset = rrSets[rrSets.length-1].rrset.readSignedSet();
    (bytes memory rrs, ) = oracle.verifyRRSet(rrSets);
    require(keccak256(rrs) == keccak256(rrset.data), 'DNSSec verification failed');

    (DKIMKey memory key, string memory domainName, bool isBridge) = parse(rrSets[rrSets.length-1]);
    if (isBridge) key.domainName = domainName;

    bytes32 id = keccak256(abi.encode(key));
    KeyInfo storage keyInfo = dkimKeys[id];
    require(!keyInfo.isExisting, 'key already exists');

    keyInfo.isExisting = true;
    keyInfo.dateAdded = uint32(block.timestamp);
    keyInfo.isBridge = isBridge;
  }

  function parse(DNSSEC.RRSetWithSignature memory txtRset) internal pure returns (DKIMKey memory key, string memory domainName, bool isBridge) {
    RRUtils.SignedSet memory txtSet = txtRset.rrset.readSignedSet();
    Strings.slice memory publicKey = string(txtSet.data).toSlice();
    publicKey.split('p='.toSlice());
    require(bytes(publicKey.toString()).length > 0, 'public key not found in txt set');
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

    (domainName, isBridge) = getDomainNameFromSignedSet(txtRset);
    key = DKIMKey(
      domainName,
      modulus,
      exponent
    );
  }

  function removeDKIMKey(bytes32 id) public {
    require(msg.sender == authorizedToRevoke, 'Address unauthorized to revoke');
    dkimKeys[id].dateRemoved = uint32(block.timestamp);
  }

  function getDomainNameFromSignedSet(DNSSEC.RRSetWithSignature memory rrSet) public pure returns(string memory, bool) {
    Strings.slice memory selector = string(rrSet.rrset.readSignedSet().data).toSlice();
    selector.rsplit(','.toSlice());
    require(bytes(selector.toString()).length > 0, 'domain name not found in txt set');

    bytes memory bridgeString = hex"646e7373656362726964676506616d6269726503636f6d0000100001000001";
    bool isBridge = selector.endsWith(string(bridgeString).toSlice());
    if (isBridge) selector.rsplit(string(bridgeString).toSlice());

    return (selector.toString(), isBridge);
  }

  function _verifyHeaders(
    string memory canonizedHeaders,
    string memory accountEmailFrom,
    string memory accountEmailTo,
    address newKeyToSet,
    SigMode mode
  ) internal pure {
      // from looks like this: from: name <email>
      // so we take what's between <> and validate it
      Strings.slice memory fromHeader = canonizedHeaders.toSlice();
      fromHeader.split('from:'.toSlice());
      fromHeader.split('<'.toSlice());
      fromHeader.rsplit('>'.toSlice());
      require(fromHeader.compare(accountEmailFrom.toSlice()) == 0, 'emailFrom not valid');

      // to looks like this: to:email
      Strings.slice memory toHeader = 'to:'.toSlice().concat(accountEmailTo.toSlice()).toSlice();
      require(canonizedHeaders.toSlice().contains(toHeader), 'emailTo not valid');

      // subject looks like this: subject:Give permissions to {address} SigMode {uint8}
      Strings.slice memory newKeyString = 'subject:Give permissions to '.toSlice()
        .concat(OpenZepellingStrings.toHexString(newKeyToSet).toSlice()).toSlice()
        .concat(' SigMode '.toSlice()).toSlice()
        .concat(OpenZepellingStrings.toString(uint8(mode)).toSlice()).toSlice();

      require(canonizedHeaders.toSlice().contains(newKeyString), 'emailSubject not valid');
  }

  //
  // Timelock
  //
  struct Timelock {
    bool isExecuted;
    uint32 whenReady;
  }

  mapping (bytes32 => Timelock) public timelocks;

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
