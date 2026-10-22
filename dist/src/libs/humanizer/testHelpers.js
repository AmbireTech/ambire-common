"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareVisualizations = exports.compareHumanizerVisualizations = void 0;
const stripVisualizationIds = (visualization) => {
    const strippedVisualization = { ...visualization, id: null };
    if (strippedVisualization.type !== 'erc7730')
        return strippedVisualization;
    return {
        ...strippedVisualization,
        intent: strippedVisualization.intent.map(stripVisualizationIds),
        // `path` is an internal identity for matching against `excludedFieldPaths`, not part of a
        // fixture's expected content - most test fixtures don't set it, so it's stripped the same way
        // `id` is, rather than requiring every hand-built row everywhere to specify a real path.
        fields: strippedVisualization.fields.map((row) => row.type === 'call'
            ? { ...row, path: undefined, value: row.value.map(stripVisualizationIds) }
            : { ...row, path: undefined, value: stripVisualizationIds(row.value) })
    };
};
const compareHumanizerVisualizations = (_calls, _expectedVisualizations) => {
    const calls = _calls.map((c) => ({
        ...c,
        fullVisualization: c.fullVisualization?.map(stripVisualizationIds)
    }));
    const expectedVisualizations = _expectedVisualizations.map((vs) => vs.map(stripVisualizationIds));
    expect(calls.length).toBe(expectedVisualizations.length);
    calls.forEach((call, i) => {
        expect(call.fullVisualization?.length || 0).toBe(expectedVisualizations[i].length);
        expect(call.fullVisualization || []).toEqual(expectedVisualizations[i]);
    });
};
exports.compareHumanizerVisualizations = compareHumanizerVisualizations;
const compareVisualizations = (v1, v2) => {
    expect(v1.length).toBe(v2.length);
    v1.forEach((v, i) => {
        expect(stripVisualizationIds(v2[i])).toMatchObject(stripVisualizationIds(v));
    });
};
exports.compareVisualizations = compareVisualizations;
//# sourceMappingURL=testHelpers.js.map