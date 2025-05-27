// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './Bytes.sol';

interface IERC1271Wallet {
	function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}

library SignatureValidator {
	using Bytes for bytes;

	enum SignatureMode {
		// the first mode Unprotected is used in combination with EIP-1271 signature verification to do
		// EIP-712 verifications, as well as "Ethereum signed message:" message verifications
		// The caveat with this is that we need to ensure that the signer key used for it isn't reused, or the message body
		// itself contains context about the wallet (such as it's address)
		// We do this, rather than applying the prefix on-chain, because if we do you won't be able to see the message
		// when signing on a hardware wallet (you'll only see the hash) - since `isValidSignature` can only receive the hash -
		// if the prefix is applied on-chain you can never match it - it's hash(prefix+hash(msg)) vs hash(prefix+msg)
		// As for transactions (`execute()`), those can be signed with any of the modes
		// Otherwise, if it's reused, we MUST use `Standard` mode which always wraps the final digest hash, but unfortnately this means
		// you can't preview the full message when signing on a HW wallet
		Unprotected,
		Standard,
		SmartWallet,
		Spoof,
		Schnorr,
		Multisig,
		// WARNING: Signature modes should not be more than 26 as the "v"
		// value for standard ecrecover is 27/28
		// WARNING: must always be last
		LastUnused
	}

	// bytes4(keccak256("isValidSignature(bytes32,bytes)"))
	bytes4 internal constant ERC1271_MAGICVALUE_BYTES32 = 0x1626ba7e;
	// secp256k1 group order
	uint256 internal constant Q = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

	function splitSignature(bytes memory sig) internal pure returns (bytes memory, uint8) {
		uint8 modeRaw;
		unchecked {
			modeRaw = uint8(sig[sig.length - 1]);
		}
		sig.trimToSize(sig.length - 1);
		return (sig, modeRaw);
	}

	function recoverAddr(bytes32 hash, bytes memory sig, bool allowSpoofing) internal view returns (address) {
		(address recovered, bool usedUnprotected) = recoverAddrAllowUnprotected(hash, sig, allowSpoofing);
		require(!usedUnprotected, 'SV_USED_UNBOUND');
		return recovered;
	}

	function recoverAddrAllowUnprotected(bytes32 hash, bytes memory sig, bool allowSpoofing) internal view returns (address, bool) {
		require(sig.length != 0, 'SV_SIGLEN');

		uint8 modeRaw;
		unchecked {
			modeRaw = uint8(sig[sig.length - 1]);
		}
		// Ensure we're in bounds for mode; Solidity does this as well but it will just silently blow up rather than showing a decent error
		if (modeRaw >= uint8(SignatureMode.LastUnused)) {
			// NOTE: this edge case is crazy powerful; first of all, why it's safe: because if you use a regular ECDSA 65-byte format defined by OpenZeppelin and others,
			// it will always end in 27 or 28, which are not valid signature modes. So it's not possible to mistake this for any other type of signature, and we'll always end up
			// hitting `modeRaw >= uint8(SignatureMode.LastUnused)` condition
			// it's used for two things
			// 1) EIP-7702 (originally designed for EIP-3074): this one is fairly obvious: we can continue validating EOA sigs as normal if the account is EIP-7702 delegated
			// This is needed because proper sig libraries should start by calling `isValidSignature` (EIP-1271) if a certain account  has code, 
			// before trying pure ECDSA (see EIP-6492 Rationale to understand why).
			// 2) EOA simulations: when we use state override to simulate stuff from an actual EOA (via virtually converting it to AmbireAccount), 
			// we may be simulating stuff that's dependent on EOA signatures that this user already made (eg swap using permit2). So within this simulation, we need to 
			// retain the permit2 sig being a valid sig.
			if (sig.length == 65) modeRaw = uint8(SignatureMode.Unprotected);
			else revert('SV_SIGMODE');
		}
		SignatureMode mode = SignatureMode(modeRaw);

		// the address of the key we are gonna be returning
		address signerKey;

		// wrap in the EIP712 wrapping if it's not unbound
		// multisig gets an exception because each inner sig will have to apply this logic
		// @TODO should spoofing be removed from this?
		bool isUnprotected = mode == SignatureMode.Unprotected || mode == SignatureMode.Multisig;
		if (!isUnprotected) {
			bytes32 DOMAIN_SEPARATOR = keccak256(abi.encode(
				keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)'),
				keccak256(bytes('Ambire')),
				keccak256(bytes('1')),
				block.chainid,
				address(this),
				bytes32(0)
			));
			hash = keccak256(abi.encodePacked(
				'\x19\x01',
				DOMAIN_SEPARATOR,
				keccak256(abi.encode(
					keccak256(bytes('AmbireOperation(address account,bytes32 hash)')),
					address(this),
					hash
				))
			));
		}

		// {r}{s}{v}{mode}
		if (mode == SignatureMode.Unprotected || mode == SignatureMode.Standard) {
			require(sig.length == 65 || sig.length == 66, 'SV_LEN');
			bytes32 r = sig.readBytes32(0);
			bytes32 s = sig.readBytes32(32);
			uint8 v = uint8(sig[64]);
			signerKey = ecrecover(hash, v, r, s);
		// {sig}{verifier}{mode}
		} else if (mode == SignatureMode.Schnorr) {
			// Based on https://hackmd.io/@nZ-twauPRISEa6G9zg3XRw/SyjJzSLt9
			// You can use this library to produce signatures: https://github.com/borislav-itskov/schnorrkel.js
			// px := public key x-coord
			// e := schnorr signature challenge
			// s := schnorr signature
			// parity := public key y-coord parity (27 or 28)
			// last uint8 is for the Ambire sig mode - it's ignored
			sig.trimToSize(sig.length - 1);
			(bytes32 px, bytes32 e, bytes32 s, uint8 parity) = abi.decode(sig, (bytes32, bytes32, bytes32, uint8));
			// ecrecover = (m, v, r, s);
			bytes32 sp = bytes32(Q - mulmod(uint256(s), uint256(px), Q));
			bytes32 ep = bytes32(Q - mulmod(uint256(e), uint256(px), Q));

			require(sp != bytes32(Q));
			// the ecrecover precompile implementation checks that the `r` and `s`
			// inputs are non-zero (in this case, `px` and `ep`), thus we don't need to
			// check if they're zero.
			address R = ecrecover(sp, parity, px, ep);
			require(R != address(0), 'SV_ZERO_SIG');
			require(e == keccak256(abi.encodePacked(R, uint8(parity), px, hash)), 'SV_SCHNORR_FAILED');
			signerKey = address(uint160(uint256(keccak256(abi.encodePacked('SCHNORR', px)))));
		} else if (mode == SignatureMode.Multisig) {
			sig.trimToSize(sig.length - 1);
			bytes[] memory signatures = abi.decode(sig, (bytes[]));
			// since we're in a multisig, we care if any of the inner sigs are unbound
			isUnprotected = false;
			for (uint256 i = 0; i != signatures.length; i++) {
				(address inner, bool isInnerUnprotected) = recoverAddrAllowUnprotected(hash, signatures[i], false);
				if (isInnerUnprotected) isUnprotected = true;
				signerKey = address(
					uint160(uint256(keccak256(abi.encodePacked(signerKey, inner))))
				);
			}
		} else if (mode == SignatureMode.SmartWallet) {
			// 32 bytes for the addr, 1 byte for the type = 33
			require(sig.length > 33, 'SV_LEN_WALLET');
			uint256 newLen;
			unchecked {
				newLen = sig.length - 33;
			}
			IERC1271Wallet wallet = IERC1271Wallet(address(uint160(uint256(sig.readBytes32(newLen)))));
			sig.trimToSize(newLen);
			require(ERC1271_MAGICVALUE_BYTES32 == wallet.isValidSignature(hash, sig), 'SV_WALLET_INVALID');
			signerKey = address(wallet);
		// {address}{mode}; the spoof mode is used when simulating calls
		} else if (mode == SignatureMode.Spoof && allowSpoofing) {
			// This is safe cause it's specifically intended for spoofing sigs in simulation conditions, where tx.origin can be controlled
			// We did not choose 0x00..00 because in future network upgrades tx.origin may be nerfed or there may be edge cases in which
			// it is zero, such as native account abstraction
			// slither-disable-next-line tx-origin
			require(tx.origin == address(1) || tx.origin == address(6969), 'SV_SPOOF_ORIGIN');
			require(sig.length == 33, 'SV_SPOOF_LEN');
			sig.trimToSize(32);
			// To simulate the gas usage; check is just to silence unused warning
			require(ecrecover(0, 0, 0, 0) != address(6969));
			signerKey = abi.decode(sig, (address));
		} else {
			revert('SV_TYPE');
		}
		require(signerKey != address(0), 'SV_ZERO_SIG');
		return (signerKey, isUnprotected);
	}
}
