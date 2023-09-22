// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './deployless/IAmbireAccount.sol';
import './libs/SignatureValidator.sol';
import './libs/Strings.sol';
import './libs/Base64.sol';
import './libs/BytesUtils.sol';
import './dkim/RSASHA256.sol';
import './dkim/DNSSEC.sol';
import './dkim/RRUtils.sol';
import './libs/OpenZeppelinStrings.sol';
import './ExternalSigValidator.sol';

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
contract DKIMRecoverySigValidator is ExternalSigValidator {
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
    // if a record has been removed by the `authorizedToRemove`, we can choose to require some time to pass before accepting that removal
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
    address newAddressToSet;
    bytes32 newPrivilegeValue;
  }

  struct KeyInfo {
    bool isExisting;
    bool isBridge;
    uint32 dateAdded;
    uint32 dateRemoved;
  }

  event RecoveryExecuted(address acc, bytes32 identifier);
  event DKIMKeyAdded(
    string domainName,
    bytes modulus,
    bytes exponent,
    uint32 dateAdded,
    bool isBridge
  );
  event DKIMKeyRemoved(bytes32 keyHash, uint32 dateRemoved, bool isBridge);

  // keccak256(Key) => KeyInfo
  mapping(bytes32 => KeyInfo) public dkimKeys;
  // recoveryIdentifier => bool
  mapping(bytes32 => bool) public recoveries;

  address public immutable authorizedToSubmit;
  address public immutable authorizedToRevoke;
  DNSSEC public immutable oracle;
  bytes private constant BRIDGE_STRING = hex'646e7373656362726964676506616d6269726503636f6d';

  // this is the bytes representation of the character that replaces "space"
  // when parsing the DNSSEC signedSet data
  bytes private constant BYTE_REPRESENTATION_SPACE_CHARACTER = hex'9b';

  constructor(DNSSEC _oracle, address _authorizedToSubmit, address _authorizedToRevoke) {
    authorizedToSubmit = _authorizedToSubmit;
    authorizedToRevoke = _authorizedToRevoke;
    oracle = _oracle;
  }

  /**
   * @notice  Validates a DKIM sig and a secondaryKey sig to perform a recovery.
   * @dev     Please read the contracts' spec for more @dev information.
   * @param   data  The AccInfo data that has privileges for the msg.sender:
   * AmbireAccount.privileges[hash] == keccak256(abi.encode(msg.sender, data))
   * @param   sig  abi.decode(SignatureMeta, dkimSig, secondSig)
   * - SignatureMeta describes the type of request that's been made. E.g.
   * SignatureMeta.mode can be Both and that means we expect a DKIM and a secondKey signature
   * @param   calls  The transactions we're executing. We make sure they are a single call
   * to AmbireAccount.setAddrPrivilege for the key in sigMeta
   * @return  bool  should execution of the passed calls proceed or not
   */
  function validateSig(
    bytes calldata data,
    bytes calldata sig,
    uint256,
    Transaction[] calldata calls
  ) external returns (bool) {
    AccInfo memory accInfo = abi.decode(data, (AccInfo));

    (SignatureMeta memory sigMeta, bytes memory dkimSig, bytes memory secondSig) = abi.decode(
      sig,
      (SignatureMeta, bytes, bytes)
    );
    bytes32 identifier = keccak256(abi.encode(msg.sender, accInfo, sigMeta));
    require(!recoveries[identifier], 'recovery already done');

    // Validate the calls: we only allow setAddrPrivilege for the pre-set newAddressToSet and newPrivilegeValue
    require(calls.length == 1, 'calls length must be 1');
    Transaction memory txn = calls[0];
    require(txn.value == 0, 'call value must be 0');
    require(txn.to == msg.sender, 'call "to" must be the ambire account addr');
    require(
      keccak256(txn.data) ==
        keccak256(
          abi.encodeWithSelector(
            IAmbireAccount.setAddrPrivilege.selector,
            sigMeta.newAddressToSet,
            sigMeta.newPrivilegeValue
          )
        ),
      'Transaction data is not set correctly, either selector, key or priv is incorrect'
    );

    SigMode mode = sigMeta.mode;
    if (mode == SigMode.Both || mode == SigMode.OnlyDKIM) {
      if (sigMeta.mode == SigMode.OnlyDKIM)
        require(accInfo.acceptEmptySecondSig, 'account disallows OnlyDKIM');

      string memory headers = sigMeta.canonizedHeaders;
      _verifyHeaders(
        headers,
        accInfo.emailFrom,
        accInfo.emailTo,
        sigMeta.newAddressToSet,
        sigMeta.newPrivilegeValue,
        sigMeta.mode
      );

      DKIMKey memory key = sigMeta.key;
      bytes memory pubKeyExponent = key.pubKeyExponent;
      bytes memory pubKeyModulus = key.pubKeyModulus;
      if (
        !(keccak256(abi.encodePacked(accInfo.domainName)) ==
          keccak256(abi.encodePacked(key.domainName)) &&
          keccak256(accInfo.dkimPubKeyExponent) == keccak256(pubKeyExponent) &&
          keccak256(accInfo.dkimPubKeyModulus) == keccak256(pubKeyModulus))
      ) {
        Strings.slice memory emailDomain = accInfo.domainName.toSlice();
        emailDomain.split('_domainkey'.toSlice());
        require(
          bytes(emailDomain.toString()).length > 0 &&
            key.domainName.toSlice().endsWith(emailDomain),
          'domain in sigMeta is not authorized for this account'
        );

        require(accInfo.acceptUnknownSelectors, 'account does not allow unknown selectors');
        KeyInfo storage keyInfo = dkimKeys[keccak256(abi.encode(key))];
        require(keyInfo.isExisting, 'non-existent DKIM key');
        uint32 dateRemoved = keyInfo.dateRemoved;
        require(
          dateRemoved == 0 || block.timestamp < dateRemoved + accInfo.waitUntilAcceptRemoved,
          'DKIM key revoked'
        );
        require(
          block.timestamp >= keyInfo.dateAdded + accInfo.waitUntilAcceptAdded,
          'DKIM key not added yet'
        );
      }

      require(
        RSASHA256.verify(sha256(bytes(headers)), dkimSig, pubKeyExponent, pubKeyModulus),
        'DKIM signature verification failed'
      );
    }

    if (mode == SigMode.Both || mode == SigMode.OnlySecond) {
      if (mode == SigMode.OnlySecond) {
        require(accInfo.acceptEmptyDKIMSig, 'account disallows OnlySecond');
        require(
          keccak256(bytes(sigMeta.canonizedHeaders)) == keccak256(bytes('')),
          'sigMeta.canonizedHeaders should be empty when SigMode is OnlySecond'
        );
        require(
          keccak256(abi.encode(sigMeta.key)) ==
            keccak256(abi.encode(DKIMKey('', bytes(''), bytes('')))),
          'sigMeta.key should be empty when SigMode is OnlySecond'
        );
      }

      require(
        SignatureValidator.recoverAddrImpl(identifier, secondSig, true) == accInfo.secondaryKey,
        'second key validation failed'
      );
    }

    // In those modes, we require a timelock
    if (mode == SigMode.OnlySecond || mode == SigMode.OnlyDKIM) {
      if (!checkTimelock(identifier, accInfo.onlyOneSigTimelock)) {
        return false;
      }
    }

    recoveries[identifier] = true;
    emit RecoveryExecuted(msg.sender, identifier);
    return true;
  }

  /**
   * @notice  Add a DKIM public key for a given DNS and domainName
   * @dev     DNSSEC verification is performed by DNSSECImpl.sol. The
   * contract originates from the ENS implementation. Unfortunately,
   * major email providers like gmail do not support DNSSEC. To be able
   * to add their keys, we use a bridge: the constant BRIDGE_STRING.
   * and it means bridge.ambire.com. To add gmail, we create a domainName
   * gmail.com.bridge.ambire.com, check whether the TXT field's signer
   * ends with bridge.ambire.com and if so, add the key for gmail.
   * This is a compromise; otherwise, gmail keys cannot be added by DNSSEC.
   * @param   sets  {bytes rrset; bytes sig} The sets to validate.
   * The final one needs to be the TXT field containing the DKIM key.
   */
  function addDKIMKeyWithDNSSec(DNSSEC.RRSetWithSignature[] calldata sets) external {
    require(
      authorizedToSubmit == address(69) || msg.sender == authorizedToSubmit,
      'not authorized to submit'
    );

    oracle.verifyRRSet(sets);

    (DKIMKey memory key, bool isBridge) = _parse(sets[sets.length - 1].rrset.readSignedSet());
    KeyInfo storage keyInfo = dkimKeys[keccak256(abi.encode(key))];
    require(!keyInfo.isExisting, 'key already exists');

    keyInfo.isExisting = true;
    keyInfo.dateAdded = uint32(block.timestamp);
    keyInfo.isBridge = isBridge;
    emit DKIMKeyAdded(
      key.domainName,
      key.pubKeyModulus,
      key.pubKeyExponent,
      uint32(block.timestamp),
      isBridge
    );
  }

  function _parse(
    RRUtils.SignedSet memory txtSignedSet
  ) internal pure returns (DKIMKey memory key, bool isBridge) {
    Strings.slice memory data = string(txtSignedSet.data).toSlice();
    data.split('p='.toSlice()); // this becomes the value after p=
    bytes memory pValue = bytes(data.toString());
    require(pValue.length > 0, 'public key not found in txt set');

    string memory base64Key = string(pValue);
    uint256 offsetOfInvalidAscii = pValue.find(
      0,
      pValue.length,
      bytes1(BYTE_REPRESENTATION_SPACE_CHARACTER)
    );
    while (offsetOfInvalidAscii != type(uint256).max) {
      bytes memory firstPartOfKey = pValue.substring(0, offsetOfInvalidAscii);
      bytes memory secondPartOfKey = pValue.substring(
        offsetOfInvalidAscii + 1,
        pValue.length - 1 - offsetOfInvalidAscii
      );
      base64Key = string(firstPartOfKey).toSlice().concat(string(secondPartOfKey).toSlice());
      offsetOfInvalidAscii = bytes(base64Key).find(
        0,
        bytes(base64Key).length,
        bytes1(BYTE_REPRESENTATION_SPACE_CHARACTER)
      );
      pValue = bytes(base64Key);
    }

    bytes memory decoded = string(base64Key).decode();
    // omit the first 32 bytes, take everything except the last 5 bytes:
    // - first two bytes from the last 5 is the exponent header info
    // - last three bytes is the exponent
    bytes memory modulus = decoded.substring(32, decoded.length - 32 - 5);
    // the last 3 bytes of the decoded string is the exponent
    bytes memory exponent = decoded.substring(decoded.length - 3, 3);

    string memory domainName;
    (domainName, isBridge) = _getDomainNameFromSignedSet(txtSignedSet);
    key = DKIMKey(domainName, modulus, exponent);
  }

  function _getDomainNameFromSignedSet(
    RRUtils.SignedSet memory signedSet
  ) internal pure returns (string memory, bool) {
    Strings.slice memory domainName = string(signedSet.data).toSlice();
    // the TXT set contains a v= field. Everything before it is the domain
    // name along with some invalid ASCII characters the RRUtils cannot
    // decode properly
    domainName.rsplit("v=".toSlice()); // this becomes the value before v=
    // if the invalid ASCII characters remain in the domainName,
    // we strip them
    if (domainName.contains(hex"000010".toSlice())) {
      domainName.rsplit(hex"000010".toSlice()); // this becomes the value before hex"000010"
    }
    require(bytes(domainName.toString()).length > 0, 'domain name not found in txt set');

    bool isBridge = domainName.endsWith(string(BRIDGE_STRING).toSlice());
    if (isBridge) domainName.rsplit(string(BRIDGE_STRING).toSlice()); // remove the bridge

    return (domainName.toString(), isBridge);
  }

  /**
   * @notice  A helper to get the domain name from a set
   * @dev     RRUtils are used to fetch the domain name from the set.
   * Most of the times, if the original domain name is ambire.com,
   * RRUtils parses it a bit differently and returns []ambire[]com, where
   * [] are invalid ascii symbols. So comparing a string ambire.com and the
   * string representation of RRUtils's domainName will not work as the
   * hexes are different. It is recommended to use this function to
   * get the domain name on and off chain.
   * @param   set  The TXT set
   */
  function getDomainNameFromSet(
    DNSSEC.RRSetWithSignature calldata set
  ) external pure returns (string memory, bool) {
    return _getDomainNameFromSignedSet(set.rrset.readSignedSet());
  }

  function _verifyHeaders(
    string memory canonizedHeaders,
    string memory accountEmailFrom,
    string memory accountEmailTo,
    address newAddressToSet,
    bytes32 newPrivilegeValue,
    SigMode mode
  ) internal pure {
    // from looks like this: from: name <email>
    // so we take what's between <> and validate it
    Strings.slice memory fromHeader = canonizedHeaders.toSlice().find('from:'.toSlice());
    fromHeader.split('<'.toSlice());
    require(
      fromHeader.startsWith(accountEmailFrom.toSlice().concat('>'.toSlice()).toSlice()),
      'emailFrom not valid'
    );

    // to looks like this: to:email
    Strings.slice memory toHeader = 'to:'
      .toSlice()
      .concat(accountEmailTo.toSlice())
      .toSlice()
      .concat('\r\n'.toSlice())
      .toSlice();
    require(canonizedHeaders.toSlice().startsWith(toHeader), 'emailTo not valid');

    // subject looks like this: subject:Give {bytes32} permissions to {address} SigMode {uint8}
    Strings.slice memory subject = 'subject:Give '
      .toSlice()
      .concat(OpenZeppelinStrings.toHexString(uint256(newPrivilegeValue)).toSlice())
      .toSlice()
      .concat(' permissions to '.toSlice())
      .toSlice()
      .concat(OpenZeppelinStrings.toHexString(newAddressToSet).toSlice())
      .toSlice()
      .concat(' SigMode '.toSlice())
      .toSlice()
      .concat(OpenZeppelinStrings.toString(uint8(mode)).toSlice())
      .toSlice()
      .concat('\r\n'.toSlice())
      .toSlice();

    // a bit of magic here
    // when using split this way, if it finds subject, it returns
    // everything after it as headersAfterSubject. If it does not find it,
    // headersAfterSubject is set to canonizedHeaders. So we check whether headersAfterSubject
    // is equal to canonizedHeaders. If it is, the subject has not been found
    Strings.slice memory headersAfterSubject = canonizedHeaders.toSlice().split(subject);
    require(!headersAfterSubject.equals(canonizedHeaders.toSlice()), 'emailSubject not valid');
  }

  /**
   * @notice  Remove a DKIM key in case it has been compromised
   * @param   id  bytes32 keccak256(abi.encode(DKIMKey))
   */
  function removeDKIMKey(bytes32 id) external {
    require(msg.sender == authorizedToRevoke, 'Address unauthorized to revoke');
    require(dkimKeys[id].dateRemoved == 0, 'Key already revoked');
    dkimKeys[id].dateRemoved = uint32(block.timestamp);
    emit DKIMKeyRemoved(id, uint32(block.timestamp), dkimKeys[id].isBridge);
  }

  //
  // Timelock
  //
  struct Timelock {
    bool isExecuted;
    uint32 whenReady;
  }

  mapping(bytes32 => Timelock) public timelocks;

  event TimelockSet(bytes32 identifier, uint32 time);
  event TimelockExecuted(bytes32 identifier);

  /**
   * @notice  Check whether a timelock has been set and can it be executed.
   * @param   identifier  keccak256(abi.encode(accountAddr, data, sigMeta))
   * @param   time  AccInfo.onlyOneSigTimelock - how much is the required
   * time to wait before the timelock can be executed
   * @return  shouldExecute  whether the timelock should be executed
   */
  function checkTimelock(bytes32 identifier, uint32 time) private returns (bool shouldExecute) {
    Timelock storage timelock = timelocks[identifier];
    require(!timelock.isExecuted, 'timelock: already executed');
    if (timelock.whenReady == 0) {
      timelock.whenReady = uint32(block.timestamp) + time;
      emit TimelockSet(identifier, timelock.whenReady);
      return false;
    } else {
      require(uint32(block.timestamp) >= timelock.whenReady, 'timelock: not ready yet');
      timelock.isExecuted = true;
      emit TimelockExecuted(identifier);
      return true;
    }
  }
}
