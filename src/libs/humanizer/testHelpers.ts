import { expect } from '@jest/globals'

import { HumanizerVisualization, IrCall } from './interfaces'

export const compareHumanizerVisualizations = (
  _calls: IrCall[],
  _expectedVisualziations: HumanizerVisualization[][]
) => {
  const calls = _calls.map((c) => ({
    ...c,
    fullVisualization: c.fullVisualization?.map((v) => ({ ...v, id: null }))
  }))
  const expectedVisualziations = _expectedVisualziations.map((vs) =>
    vs.map((v) => ({ ...v, id: null }))
  )
  expect(calls.length).toBe(expectedVisualziations.length)
  calls.forEach((call, i) => {
    expect(call.fullVisualization?.length).toBe(expectedVisualziations[i].length)
    expect(call.fullVisualization).toEqual(expectedVisualziations[i])
  })
}
