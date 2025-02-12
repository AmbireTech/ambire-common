"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportStatus = void 0;
/**
 * Enum for tracking the import status of an account during the import process.
 */
var ImportStatus;
(function (ImportStatus) {
    ImportStatus["NotImported"] = "not-imported";
    ImportStatus["ImportedWithoutKey"] = "imported-without-key";
    ImportStatus["ImportedWithSomeOfTheKeys"] = "imported-with-some-of-the-keys";
    // some of the keys (having the same key type), but not all found on the current page
    ImportStatus["ImportedWithTheSameKeys"] = "imported-with-the-same-keys";
    // keys (having the same key type) found on the current page
    ImportStatus["ImportedWithDifferentKeys"] = "imported-with-different-keys"; // different key
    // meaning that could be a key with the same address but different type,
    // or a key with different address altogether.
})(ImportStatus = exports.ImportStatus || (exports.ImportStatus = {}));
//# sourceMappingURL=account.js.map