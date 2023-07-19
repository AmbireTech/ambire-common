// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

/**
 * @dev An interface for contracts implementing a DNSSEC (signing) algorithm.
 */
interface Algorithm {
    /**
     * @dev Verifies a signature.
     * @param key The public key to verify with.
     * @param data The signed data to verify.
     * @param signature The signature to verify.
     * @return True iff the signature is valid.
     */
    function verify(
        bytes calldata key,
        bytes calldata data,
        bytes calldata signature
    ) external view returns (bool);
}
