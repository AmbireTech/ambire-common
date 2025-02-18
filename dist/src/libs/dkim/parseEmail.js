"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/*
  parse and return email data
  (nodejs)
*/
const parse_1 = require("./parse");
const getPublicKey_1 = tslib_1.__importDefault(require("./getPublicKey"));
const publicKeyToComponents_1 = tslib_1.__importDefault(require("./publicKeyToComponents"));
const toSolidity_1 = tslib_1.__importDefault(require("./toSolidity"));
const crypto_1 = require("crypto");
async function parseEmail(email) {
    const dkims = (0, parse_1.parse)(email).dkims.map((dkim) => {
        const algorithm = dkim.algorithm
            .split('-')
            .pop()
            .toUpperCase();
        const bodyHash = (0, crypto_1.createHash)(algorithm)
            .update(dkim.processedBody)
            .digest();
        const bodyHashMatched = bodyHash.compare(dkim.signature.hash) !== 0;
        if (bodyHashMatched) {
            throw new Error('body hash did not verify');
        }
        const hash = (0, crypto_1.createHash)(algorithm)
            .update(dkim.processedHeader)
            .digest();
        return {
            ...dkim,
            hash
        };
    });
    // get dns records
    const publicKeysEntries = await Promise.all(dkims.map((dkim) => (0, getPublicKey_1.default)({
        domain: dkim.signature.domain,
        selector: dkim.signature.selector
    })));
    const publicKeys = publicKeysEntries.map((entry) => {
        const { publicKey } = entry;
        const { exponent, modulus } = (0, publicKeyToComponents_1.default)(publicKey);
        return {
            ...entry,
            exponent,
            modulus
        };
    });
    return dkims.map((dkim, i) => {
        const solidity = (0, toSolidity_1.default)({
            algorithm: dkim.algorithm,
            hash: dkim.hash,
            signature: dkim.signature.signature,
            exponent: publicKeys[i].exponent,
            modulus: publicKeys[i].modulus
        });
        return {
            ...dkim,
            ...publicKeys[i],
            solidity
        };
    });
}
exports.default = parseEmail;
//# sourceMappingURL=parseEmail.js.map