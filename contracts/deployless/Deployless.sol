// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.11;

contract Deployless {
    error DeployFailed();
    constructor(bytes memory contractCode, bytes memory data) {
        address toCall;
        assembly {
            toCall := create(0, add(contractCode, 0x20), mload(contractCode))
        }
        if (toCall.code.length == 0) revert DeployFailed();
        // We don't care about `bool success`
        (, bytes memory returnData) = toCall.call(data);
        uint size = returnData.length;
        assembly {
            return (add(returnData, 32), size)
        }
    }
}
