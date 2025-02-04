export const getHdPathFromTemplate = (hdPathTemplate, index) => {
    return hdPathTemplate.replace('<account>', index.toString());
};
const HARDENED_OFFSET = 0x80000000;
export const getHDPathIndices = (hdPathTemplate, insertIdx = 0) => {
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
//# sourceMappingURL=hdPath.js.map