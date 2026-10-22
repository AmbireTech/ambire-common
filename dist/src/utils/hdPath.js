"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDerivableHdPathTemplates = exports.getHdPathTemplateRelativeToOrigin = exports.getHDPathIndices = exports.getHdPathWithoutRoot = exports.getParentHdPathFromTemplate = exports.getHdPathFromTemplate = void 0;
const derivation_1 = require("../consts/derivation");
const getHdPathFromTemplate = (hdPathTemplate, index) => {
    return hdPathTemplate.replace('<account>', index.toString());
};
exports.getHdPathFromTemplate = getHdPathFromTemplate;
const getParentHdPathFromTemplate = (hdPathTemplate) => {
    return hdPathTemplate.split('/<account>')[0];
};
exports.getParentHdPathFromTemplate = getParentHdPathFromTemplate;
const getHdPathWithoutRoot = (hdPath) => hdPath.slice(2);
exports.getHdPathWithoutRoot = getHdPathWithoutRoot;
const HARDENED_OFFSET = 0x80000000;
const getHDPathIndices = (hdPathTemplate, insertIdx = 0) => {
    const path = hdPathTemplate.split('/').slice(1);
    const indices = [];
    let usedX = false;
    path.forEach((_idx) => {
        const isHardened = _idx[_idx.length - 1] === "'";
        let idx = isHardened ? HARDENED_OFFSET : 0;
        // If there is an `<account>` in the path string, we will use it to insert our
        // index. This is useful for e.g. Ledger Live path. Most paths have the
        // changing index as the last one, so having an `<account>` in the path isn't
        // usually necessary.
        if (_idx.indexOf('<account>') > -1) {
            idx += insertIdx;
            usedX = true;
        }
        else if (isHardened) {
            idx += Number(_idx.slice(0, _idx.length - 1));
        }
        else {
            idx += Number(_idx);
        }
        indices.push(idx);
    });
    // If this path string does not include an `<account>`, we just append the index
    // to the end of the extracted set
    if (usedX === false) {
        indices.push(insertIdx);
    }
    // Sanity check -- Lattice firmware will throw an error for large paths
    if (indices.length > 5)
        throw new Error('Only HD paths with up to 5 indices are allowed.');
    return indices;
};
exports.getHDPathIndices = getHDPathIndices;
/**
 * The part of an HD path template that is relative to `originPath` - the path an
 * extended public key was exported from. Returns null when the template does not
 * branch off the origin (e.g. a hardened account index), meaning that extended
 * public key cannot derive it.
 */
const getHdPathTemplateRelativeToOrigin = (originPath, hdPathTemplate) => {
    const originLevels = originPath.split('/');
    const templateLevels = hdPathTemplate.split('/');
    if (templateLevels.length <= originLevels.length)
        return null;
    if (originLevels.some((level, i) => level !== templateLevels[i]))
        return null;
    return templateLevels.slice(originLevels.length).join('/');
};
exports.getHdPathTemplateRelativeToOrigin = getHdPathTemplateRelativeToOrigin;
/**
 * Which of the offered derivation paths an extended public key exported from
 * `originPath` can browse. Wallets that hand over a single extended public key
 * (QR, NFC) are limited to these.
 */
const getDerivableHdPathTemplates = (originPath) => derivation_1.DERIVATION_OPTIONS.map(({ value }) => value).filter((template) => !!(0, exports.getHdPathTemplateRelativeToOrigin)(originPath, template));
exports.getDerivableHdPathTemplates = getDerivableHdPathTemplates;
//# sourceMappingURL=hdPath.js.map