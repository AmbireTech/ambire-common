import { HumanizerVisualization, IrCall } from './interfaces'

const stripVisualizationIds = (visualization: HumanizerVisualization): HumanizerVisualization => {
  const strippedVisualization = { ...visualization, id: null as any }

  if (strippedVisualization.type !== 'erc7730') return strippedVisualization

  return {
    ...strippedVisualization,
    rows: strippedVisualization.rows.map((row) => ({
      ...row,
      value: row.value.map(stripVisualizationIds)
    }))
  }
}

export const compareHumanizerVisualizations = (
  _calls: IrCall[],
  _expectedVisualizations: HumanizerVisualization[][]
) => {
  const calls = _calls.map((c) => ({
    ...c,
    fullVisualization: c.fullVisualization?.map(stripVisualizationIds)
  }))
  const expectedVisualizations = _expectedVisualizations.map((vs) => vs.map(stripVisualizationIds))
  expect(calls.length).toBe(expectedVisualizations.length)
  calls.forEach((call, i) => {
    expect(call.fullVisualization?.length || 0).toBe(expectedVisualizations[i]!.length)
    expect(call.fullVisualization || []).toEqual(expectedVisualizations[i])
  })
}

export const compareVisualizations = (
  v1: HumanizerVisualization[],
  v2: HumanizerVisualization[]
) => {
  expect(v1.length).toBe(v2.length)
  v1.forEach((v, i) => {
    expect(stripVisualizationIds(v2[i]!)).toMatchObject(stripVisualizationIds(v))
  })
}
