// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

contract HelloWorld {
	function helloWorld() external pure returns (string memory) {
		return "hello world";
	}

    function throwAssertError() external pure returns (uint) {
        assert(1 > 1);
        return 1;
    }

    function throwArithmeticError() external pure returns (uint8) {
        uint8 z = 240;
        uint8 x = 240;
        z = z + x;
        return z;
    }

    function throwDivisionByZeroError() external pure returns (uint) {
        uint8 z = 240;
        uint8 x = 0;
        unchecked {
            z = z / x;
        }
        return z;
    }

    function throwCompilerPanic() external pure returns (string memory) {
        string[] memory outOfRange;
        return outOfRange[1];
    }
}