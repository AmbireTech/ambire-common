import { HumanizerVisualizationItem, IrCall, RichHumanizerVisualization } from './interfaces'

const stripVisualizationIds = (
  visualization: HumanizerVisualizationItem
): HumanizerVisualizationItem => ({ ...visualization, id: null as any })

export const compareHumanizerVisualizations = (
  _calls: IrCall[],
  _expectedVisualizations: HumanizerVisualizationItem[][]
) => {
  const calls = _calls.map((c) => ({
    ...c,
    intent: c.fullVisualization?.intent.map(stripVisualizationIds)
  }))
  const expectedVisualizations = _expectedVisualizations.map((vs) => vs.map(stripVisualizationIds))
  expect(calls.length).toBe(expectedVisualizations.length)
  calls.forEach((call, i) => {
    expect(call.intent?.length || 0).toBe(expectedVisualizations[i]!.length)
    expect(call.intent || []).toEqual(expectedVisualizations[i])
  })
}

export const compareVisualizations = (
  v1: HumanizerVisualizationItem[],
  v2: HumanizerVisualizationItem[]
) => {
  expect(v1.length).toBe(v2.length)
  v1.forEach((v, i) => {
    expect(stripVisualizationIds(v2[i]!)).toMatchObject(stripVisualizationIds(v))
  })
}

const stripRichVisualizationIds = (
  visualization: RichHumanizerVisualization
): RichHumanizerVisualization => ({
  ...visualization,
  intent: visualization.intent.map(stripVisualizationIds),
  fields: visualization.fields.map((row) =>
    row.type === 'call'
      ? { ...row, value: stripRichVisualizationIds(row.value) }
      : { ...row, value: stripVisualizationIds(row.value) }
  )
})

/** Compares a rich visualization with the expected one, ignoring the random ids of every item in it. */
export const compareRichVisualization = (
  actual: RichHumanizerVisualization | undefined,
  expected: RichHumanizerVisualization
) => {
  expect(actual).toBeDefined()
  expect(stripRichVisualizationIds(actual!)).toMatchObject(stripRichVisualizationIds(expected))
}

/** Compares the visualization of every call with the expected one. */
export const compareRichVisualizations = (
  calls: IrCall[],
  expectedVisualizations: RichHumanizerVisualization[]
) => {
  expect(calls.length).toBe(expectedVisualizations.length)
  calls.forEach((call, i) =>
    compareRichVisualization(call.fullVisualization, expectedVisualizations[i]!)
  )
}
