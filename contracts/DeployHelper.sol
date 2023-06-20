// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import "./AmbireAccount.sol";
import "./AmbireAccountFactory.sol";

contract DeployHelper {
  constructor() {
    new AmbireAccount();
    new AmbireAccountFactory(0x942f9CE5D9a33a82F88D233AEb3292E680230348);
    // no need to selfdestruct because it doesn't give a refund anymore
  }
}
