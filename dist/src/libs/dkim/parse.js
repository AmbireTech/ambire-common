"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parse = void 0;
const tslib_1 = require("tslib");
const isDKIM_1 = tslib_1.__importDefault(require("./isDKIM"));
/*
  parse email
  (cross-platform)
*/
const Signature = require("dkim-signature");
const processHeader = require("dkim/lib/process-header");
const processBody = require("dkim/lib/process-body");
const emailToHeaderAndBody = (email) => {
    const boundary = email.indexOf("\r\n\r\n");
    if (boundary === -1) {
        throw Error("no header boundary found");
    }
    const header = email.slice(0, boundary);
    const body = email.slice(boundary + 4);
    return {
        boundary,
        header,
        body
    };
};
const getDkimEntry = (dkim) => {
    const [name, ...rest] = dkim.split(":");
    return {
        name,
        value: rest.join(":").slice(1)
    };
};
const getDkims = (header) => {
    return header
        .split(/\r\n(?=[^\x20\x09]|$)/g)
        .map((h, i, allHeaders) => {
        if ((0, isDKIM_1.default)(h)) {
            // remove DKIM headers
            const headers = allHeaders.filter((v) => !(0, isDKIM_1.default)(v));
            // add one DKIM header
            headers.unshift(h);
            return {
                entry: getDkimEntry(h),
                headers
            };
        }
        return undefined;
    })
        .filter((v) => !!v);
};
function parse(email) {
    const { header, body } = emailToHeaderAndBody(email);
    const dkims = getDkims(header).map((dkim) => {
        // a new field called dara has been introduced to DKIM signature
        // standarts. We add it manually as the lib does not support it
        if (dkim.entry.value.indexOf('dara') !== -1) {
            Signature.fields.push('dara');
            Signature.keys.push('dara');
        }
        const signature = Signature.parse(dkim.entry.value);
        const sigBody = signature.length != null ? body.slice(0, signature.length) : body;
        const processedBody = processBody(sigBody, signature.canonical.split("/").pop());
        const processedHeader = processHeader(dkim.headers, signature.headers, signature.canonical.split("/").shift());
        const algorithm = signature.algorithm.toUpperCase();
        return {
            ...dkim,
            signature,
            processedBody,
            processedHeader,
            algorithm
        };
    });
    return {
        header,
        body,
        dkims
    };
}
exports.parse = parse;
;
//# sourceMappingURL=parse.js.map