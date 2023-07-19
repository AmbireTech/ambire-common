// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.19;

/**
 * @dev An interface for contracts implementing a DNSSEC digest.
 */
interface Digest {
    /**
     * @dev Verifies a cryptographic hash.
     * @param data The data to hash.
     * @param hash The hash to compare to.
     * @return True iff the hashed data matches the provided hash value.
     */
    function verify(
        bytes calldata data,
        bytes calldata hash
    ) external pure returns (bool);
}
