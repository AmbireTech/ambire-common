export const compareHumanizerVisualizations = (_calls, _expectedVisualizations) => {
    const calls = _calls.map((c) => ({
        ...c,
        fullVisualization: c.fullVisualization?.map((v) => ({ ...v, id: null }))
    }));
    const expectedVisualizations = _expectedVisualizations.map((vs) => vs.map((v) => ({ ...v, id: null })));
    expect(calls.length).toBe(expectedVisualizations.length);
    calls.forEach((call, i) => {
        expect(call.fullVisualization?.length || 0).toBe(expectedVisualizations[i].length);
        expect(call.fullVisualization || []).toEqual(expectedVisualizations[i]);
    });
};
export const compareVisualizations = (v1, v2) => {
    expect(v1.length).toBe(v2.length);
    v1.forEach((v, i) => {
        expect({ ...v2[i], id: null }).toMatchObject({ ...v, id: null });
    });
};
//# sourceMappingURL=testHelpers.js.map