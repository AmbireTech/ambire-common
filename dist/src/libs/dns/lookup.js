"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { DNSProver } = require('@ensdomains/dnsprovejs');
/**
 * The method returns a SignedSet answer if found or throws an exception
 * if it could not verify it. So in the case of NoValidDnskeyError, we
 * silently return null to indicate that no SignedSet exists for this record.
 * If the error is of a different kind, we throw it.
 *
 * @param selector string "20221208" from example 20221208._domainkey.gmail.com
 * @param domain string "gmail.com" from example 20221208._domainkey.gmail.com
 * @param opt: Options
 * @returns {answer: SignedSet, proofs: [SignedSet,SignedSet,...]}
 */
async function lookup(selector, domain, opt = {}) {
    const provider = opt.apiProvider ?? 'https://cloudflare-dns.com/dns-query';
    const textDomain = `${selector}._domainKey.${domain}`;
    const prover = DNSProver.create(provider);
    try {
        const res = await prover.queryWithProof('TXT', textDomain);
        return res;
    }
    catch (error) {
        if (error.name == 'NoValidDnskeyError')
            return null;
        throw new Error(error.message);
    }
}
exports.default = lookup;
//# sourceMappingURL=lookup.js.map