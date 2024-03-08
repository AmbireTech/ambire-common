// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './AmbireAccount.sol';
import './AmbireAccountFactory.sol';
import './AmbirePaymaster.sol';

contract DeployHelperStaging {
  constructor() {
    new AmbireAccount();
    new AmbireAccountFactory(0x942f9CE5D9a33a82F88D233AEb3292E680230348);
    new AmbirePaymaster(0x706431177041C87BEb1C25Fa29b92057Cb3c7089);
    // no need to selfdestruct because it doesn't give a refund anymore
  }
}
