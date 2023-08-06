// NOTE: we only support RSA-SHA256 DKIM signatures, this is whhy we do not have an algorithm field atm

import "./AmbireAccount.sol";

contract DKIMRecoverySigValidator {
  // @TODO
  struct DKIMKey {
    string domainName;
    bytes pubKey;
  }

  struct AccInfo {
    string emailFrom;
    string emailTo;
    // DKIM key
    // We have to additionally verify if it matches the domain in emailFrom
    DKIMKey key;
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
    // @TODO BUG/ISSUE: if both of those are set to true, we can trigger the timelock without anything
  }

  // we need SigMode (OnlyDKIM, OnlySecond, Both) in the identifier itself, otherwise sigs are malleable (you can front-run a modified sig to trigger the timelock)
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

  function validateSig(
    address accountAddr,
    bytes calldata data,
    bytes calldata sig,
    uint nonce,
    AmbireAccount.Transaction[] calldata calls
  ) external returns (bool shouldExecute) {
    (AccInfo memory accInfo) = abi.decode(data, (AccInfo));
    (SignatureMeta memory sigMeta, bytes memory dkimSig, bytes memory secondSig) = abi.decode(sig, (SignatureMeta, bytes, bytes));
    bytes32 identifier = keccak256(abi.encode(accountAddr, accInfo, sigMeta));

    // First step: we get the DKIM record we're using
    DKIMKey memory key = sigMeta.key;
    if (!(accInfo.key.domainName == key.domainName && accInfo.key.pubKey == key.pubKey)) {
      bytes32 keyId = keccak256(abi.encode(sigMeta.key));
      require(accInfo.acceptUnknownSelectors, 'account does not allow unknown selectors');
      KeyInfo storage keyInfo = dkimKeys[keyId];
      require(keyInfo.isExisting, 'non-existant DKIM key');
      require(keyInfo.dateRemoved == 0 || block.timestamp < keyInfo.dateRemoved + accInfo.waitUntilAcceptRemoved, 'DKIM key revoked');
      require(block.timestamp >= keyInfo.dateAdded + accInfo.waitUntilAcceptAdded, 'DKIM key not added yet');
    }

    // @TODO validate .domainName against emailFrom
    // @TODO check if there is only one entry left of _domainKey
    // @TODO maybe this will be easier if we pass selector in sigMeta
    require(
      String.endsWith(
        key.domainName,
        String.concat('._domainKey.', String.split(accInfo.emailFrom, '@')[1]
      ),
      'invalid domainName'
    );

    // @TODO if we return true, we should flag the `identifier` as executed

    // @TODO aquire domainName so that we can compare that
    if (sigMeta.dkimKey.selector != accInfo.dkimSelector) {
      // @TODO
      const dateAdded = dkimKeys[keccak256(signature.dkimKey)]
      if (dateAdded == 0) {
        // require(signature.rrSets.length > 0, 'no DNSSec proof and no valid DKIM key')
        // dkimKey = addDKIMKeyWithDNSSec(signature.rrSets)
      } else {
        require(block.timestamp > dateAdded + accInfo.timelockForUnknownKeys, 'key added too recently, timelock not ready yet')
        dkimKey = signature.dkimKey
      }
    }
    // @TODO single sig mode, timelock

    // @TODO parse canonizedHeaders, verify thge DKIM sig, verify the secondary sig, verify that .calls is correcct (only one call to setAddrPrivilege with the newKeyToSet)
  }

  function addDKIMKeyWithDNSSec(bytes[] rrSets, string txtRecord) returns (DKIMKey) {
    require(authorizedToSubmit == address(69) || msg.sender == authorizedToSubmit, 'not authorized to submit');
    require(dnssecOracle.verify(rrSets, txtRecord), 'DNSSec verification failed')

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

  // @TODO the sig verification logic itself
  // @TODO check from bobi


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
