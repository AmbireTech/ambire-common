// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.19;

import './Bytes.sol';

interface IERC1271Wallet {
	function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}

library SignatureValidator {
	using Bytes for bytes;

	enum SignatureMode {
		EIP712,
		EthSign,
		SmartWallet,
		Spoof,
		Schnorr,
		Multisig,
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

	function recoverAddr(bytes32 hash, bytes memory sig) internal view returns (address) {
		return recoverAddrImpl(hash, sig, false);
	}

	function recoverAddrImpl(bytes32 hash, bytes memory sig, bool allowSpoofing) internal view returns (address) {
		require(sig.length != 0, 'SV_SIGLEN');
		uint8 modeRaw;
		unchecked {
			modeRaw = uint8(sig[sig.length - 1]);
		}
		// Ensure we're in bounds for mode; Solidity does this as well but it will just silently blow up rather than showing a decent error
		require(modeRaw < uint8(SignatureMode.LastUnused), 'SV_SIGMODE');
		SignatureMode mode = SignatureMode(modeRaw);

		// {r}{s}{v}{mode}
		if (mode == SignatureMode.EIP712 || mode == SignatureMode.EthSign) {
			require(sig.length == 66, 'SV_LEN');
			bytes32 r = sig.readBytes32(0);
			bytes32 s = sig.readBytes32(32);
			uint8 v = uint8(sig[64]);
			if (mode == SignatureMode.EthSign) hash = keccak256(abi.encodePacked('\x19Ethereum Signed Message:\n32', hash));
			address signer = ecrecover(hash, v, r, s);
			require(signer != address(0), 'SV_ZERO_SIG');
			return signer;
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
			return address(uint160(uint256(keccak256(abi.encodePacked('SCHNORR', px)))));
		} else if (mode == SignatureMode.Multisig) {
			sig.trimToSize(sig.length - 1);
			bytes[] memory signatures = abi.decode(sig, (bytes[]));
			address signer;
			for (uint256 i = 0; i != signatures.length; i++) {
				signer = address(
					uint160(uint256(keccak256(abi.encodePacked(signer, recoverAddrImpl(hash, signatures[i], false)))))
				);
			}
			require(signer != address(0), 'SV_ZERO_SIG');
			return signer;
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
			address signer = address(wallet);
			require(signer != address(0), 'SV_ZERO_SIG');
			return signer;
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
			return abi.decode(sig, (address));
		}
		revert('SV_TYPE');
	}
}
