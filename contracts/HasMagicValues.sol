// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

abstract contract HasMagicValues {
	uint72 internal immutable SUCCESS_MAGIC_VALUE = 18446744073709551616;
	uint72 internal immutable FAIL_MAGIC_VALUE = 18446744073709551617;
}