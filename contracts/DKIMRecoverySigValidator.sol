// SPDX-License-Identifier: agpl-3.0
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

/**
 * @notice  A validator that performs DKIM signature recovery
 * @dev     The DKIM signature is taken from an email along
 * with its contents. The email contains information about the
 * new key and the sigMode requested. To execute the request immediately,
 * two signatures are needed - the DKIM sig and a secondaryKey signature.
 * That is represented by sigMode.Both.
 * If one of the things are missing (user has lost access to his email or
 * he has lost his secondaryKey), a timelock is required. That is handled
 * by mode.onlyDKIM or mode.OnlySecond. The account needs to allow single
 * signature recoveries for that. The duration of the timelock is set in
 * AccInfo.onlyOneSigTimelock.
 * DKIM validation checks the email headers - whether "from" is the
 * account email, whether "to" is the specified receiver, and whether
 * the subject contains the signerKey and sigMode. Afterwards, it performs
 * an RSASHA256 verification. Only RSASHA256 is supported so DKIM signatures
 * from different algorithms will not work.
 * All the DKIM public keys are kept in dkimKeys and are added by providing
 * valid rrSets for the given DNS, or DNSSEC verification.
 * The secondSig is a signature on keccak256(abi.encode(address(accountAddr), calls)).
 */
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

  address public authorizedToSubmit;
  address public authorizedToRevoke;
  DNSSEC public oracle;
  constructor(DNSSEC _oracle, address _authorizedToSubmit, address _authorizedToRevoke) {
    authorizedToSubmit = _authorizedToSubmit;
    authorizedToRevoke = _authorizedToRevoke;
    oracle = _oracle;
  }

  /**
   * @notice  Validates a DKIM sig and a secondaryKey sig to perform a recovery.
   * @dev     Please read the contracts' spec for more @dev information.
   * @param   accountAddr  The AmbireAccount.sol address
   * @param   data  The AccInfo data that has priviledges for the accountAddr:
   * AmbireAccount.privileges[hash] == keccak256(abi.encode(accountAddr, data))
   * @param   sig  abi.decode(SignatureMeta, dkimSig, secondSig)
   * - SignatureMeta describes the type of request that's been made. E.g.
   * SignatureMeta.mode can be Both and that means we expect a DKIM and a secondKey signature
   * @param   calls  The transactions we're executing. We make sure they are a single call
   * to AmbireAccount.setAddrPrivilege for the key in sigMeta
   * @return  bool  should execution of the passed calls proceed or not
   */
  function validateSig(
    address accountAddr,
    bytes calldata data,
    bytes calldata sig,
    uint256,
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

  /**
   * @notice  Add a DKIM public key for a given DNS and selector
   * @dev     DNSSEC verification is performed by DNSSECImpl.sol. The
   * contract originates from the ENS implementation. Unfortunatelly,
   * major email providers like gmail do not support DNSSEC. To be able
   * to add their keys, we use a bridge. The bridge string is this:
   * 646e7373656362726964676506616d6269726503636f6d0000100001000001
   * an it means bridge.ambire.com. To add gmail, we create a selector
   * gmail.com.bridge.ambire.com, check whether the TXT field's signer
   * ends with bridge.ambire.com and if so, add the key for gmail.
   * This is a compromise; otherwise, gmail keys cannot be added by DNSSEC.
   * @param   rrSets  The rrSets to validate. The final one needs to be
   * the TXT field containing the DKIM key.
   */
  function addDKIMKeyWithDNSSec(DNSSEC.RRSetWithSignature[] memory rrSets) external {
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
    bytes memory pValue = bytes(publicKey.toString());
    require(pValue.length > 0, 'public key not found in txt set');

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

  /**
   * @notice  Remove a DKIM key in case it has been compromised
   * @param   id  bytes32 keccak256(abi.encode(DKIMKey))
   */
  function removeDKIMKey(bytes32 id) external {
    require(msg.sender == authorizedToRevoke, 'Address unauthorized to revoke');
    dkimKeys[id].dateRemoved = uint32(block.timestamp);
  }

  /**
   * @notice  A helper to get the domain name from an rrSet
   * @dev     RRUtils are used to fetch the domain name from the set.
   * Most of the times, if the original domain name is ambire.com,
   * RRUtils parses it a bit differently and returns []ambire[]com, where
   * [] are invalid ascii symbols. So comparing a string ambire.com and the
   * string represenation of RRUtils's domainName will not work as the
   * hexes are different. It is recommended to use this function to
   * get the domain name on and off chain.
   * @param   rrSet  The TXT rrSet
   */
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
      Strings.slice memory fromHeader = canonizedHeaders.toSlice().find('from:'.toSlice());
      fromHeader.split('<'.toSlice());
      require(fromHeader.startsWith(accountEmailFrom.toSlice().concat('>'.toSlice()).toSlice()), 'emailFrom not valid');

      // to looks like this: to:email
      Strings.slice memory toHeader = 'to:'.toSlice().concat(accountEmailTo.toSlice()).toSlice();
      require(canonizedHeaders.toSlice().startsWith(toHeader), 'emailTo not valid');

      // subject looks like this: subject:Give permissions to {address} SigMode {uint8}
      Strings.slice memory newKeyString = 'subject:Give permissions to '.toSlice()
        .concat(OpenZepellingStrings.toHexString(newKeyToSet).toSlice()).toSlice()
        .concat(' SigMode '.toSlice()).toSlice()
        .concat(OpenZepellingStrings.toString(uint8(mode)).toSlice()).toSlice();

      // a bit of magic here
      // when using split this way, if it finds newKeyString, it returns
      // everything before it as subject. If it does not find it,
      // subject is set to canonizedHeaders. So we check whether subject
      // is equal to canonizedHeaders. If it is, the subject has not been found
      Strings.slice memory subject = canonizedHeaders.toSlice().split(newKeyString);
      require(!subject.equals(canonizedHeaders.toSlice()), 'emailSubject not valid');
  }

  //
  // Timelock
  //
  struct Timelock {
    bool isExecuted;
    uint32 whenReady;
  }

  mapping (bytes32 => Timelock) public timelocks;

  /**
   * @notice  Check whether a timelock has been set and can it be executed.
   * @param   identifier  keccak256(abi.encode(accountAddr, data, sigMeta))
   * @param   time  AccInfo.onlyOneSigTimelock - how much is the required
   * time to wait before the timelock can be executed
   * @return  shouldExecute  whether the timelock should be executed
   */
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
