"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSignatureHex = normalizeSignatureHex;
const ethers_1 = require("ethers");
const addHexPrefix_1 = require("./addHexPrefix");
const stripHexPrefix_1 = require("./stripHexPrefix");
function normalizeSignatureHex(input) {
    if (input.hex)
        return (0, addHexPrefix_1.addHexPrefix)((0, stripHexPrefix_1.stripHexPrefix)(input.hex));
    if (!input.r || !input.s || input.v === undefined) {
        throw new Error('normalizeSignatureHex: missing signature fields');
    }
    try {
        const signature = ethers_1.Signature.from({
            r: input.r,
            s: input.s,
            v: ethers_1.Signature.getNormalizedV(input.v)
        });
        return signature.serialized;
    }
    catch {
        throw new Error('normalizeSignatureHex: invalid signature payload');
    }
}
//# sourceMappingURL=normalizeSignatureHex.js.map