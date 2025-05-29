"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchStorageApps = void 0;
/**
 * A temporary function used to patch apps stored in storage. As both predefined and custom apps
 * are stored in the same place and we don't have a mechanism to differentiate between them, we need to
 * remove the predefined ones from the storage.
 */
const patchStorageApps = (storageDapps) => {
    return storageDapps.reduce((acc, curr) => {
        // Remove legends from the list as it was replaced with rewards.ambire.com
        if (curr.url.includes('legends.ambire.com')) {
            return acc;
        }
        return [...acc, curr];
    }, []);
};
exports.patchStorageApps = patchStorageApps;
//# sourceMappingURL=helpers.js.map