interface Options {
    apiProvider?: string;
}
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
export default function lookup(selector: string, domain: string, opt?: Options): Promise<any>;
export {};
//# sourceMappingURL=lookup.d.ts.map