import '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol';

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract LegendsNft is ERC1967Proxy {
  // follows exactly the storage slots of the LegendsNft Contract
  address implementationOwner;
  string _name;
  string _symbol;

  constructor(
    address implementation,
    string memory name,
    string memory symbol
  ) ERC1967Proxy(implementation, '') {
    _name = name;
    _symbol = symbol;
    implementationOwner = msg.sender;
    _changeAdmin(msg.sender);
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

  function setImplementation(address implementation) public {
    require(msg.sender == _getAdmin(), 'Not authorized');
    _upgradeTo(implementation);
  }
}
