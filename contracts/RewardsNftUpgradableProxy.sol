import '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol';

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract AmbireRewardsNFT is ERC1967Proxy {
  // follows exactly the storage slots of the implementation Contract
  address implementationOwner;
  string _name;
  string _symbol;

  constructor(
    address implAddress,
    string memory name,
    string memory symbol,
    address initialAdmin
  ) ERC1967Proxy(implAddress, '') {
    _name = name;
    _symbol = symbol;
    implementationOwner = initialAdmin;
    _changeAdmin(initialAdmin);
  }

  function admin() public view returns (address) {
    return _getAdmin();
  }

  function implementation() public view returns (address) {
    return _getImplementation();
  }

  function setAdmin(address newAdmin) public {
    require(msg.sender == _getAdmin(), 'Not authorized');
    _changeAdmin(newAdmin);
  }

  function setImplementation(address implAddress) public {
    require(msg.sender == _getAdmin(), 'Not authorized');
    _upgradeTo(implAddress);
  }
}
