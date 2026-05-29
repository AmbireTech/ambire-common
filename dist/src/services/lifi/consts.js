"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HUMANIZED_ERRORS = exports.LIFI_EXPLORER_URL = void 0;
exports.LIFI_EXPLORER_URL = 'https://scan.li.fi';
exports.HUMANIZED_ERRORS = [
    {
        reasons: ['could not find token'],
        message: 'The token you are trying to swap is not supported by our service provider. Please select another token.'
    },
    {
        reasons: ['The same token cannot be used as both the source and destination'],
        message: 'The same token cannot be used as both the source and destination.'
    },
    {
        reasons: ['is invalid or in deny list'],
        message: 'This token is not supported by our service provider.'
    }
];
//# sourceMappingURL=consts.js.map