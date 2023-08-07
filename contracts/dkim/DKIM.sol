// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

contract DKIM {
    struct PublicKey {
        bytes exponent;
        bytes modulus;
    }
}