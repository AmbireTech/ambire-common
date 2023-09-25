import { AccountOp } from 'libs/accountOp/accountOp'

import {
  HumanizerFragment,
  HumanizerParsingModule,
  HumanizerWarning,
  IrCall,
  IrMessage
} from '../interfaces'

// eslint-disable-next-line class-methods-use-this
export function parseCalls(
  accountOp: AccountOp,
  calls: IrCall[],
  modules: HumanizerParsingModule[],
  options?: any
): [IrCall[], Promise<HumanizerFragment | null>[]] {
  const asyncOps: Promise<HumanizerFragment | null>[] = []
  const newCalls = calls.map((call) => {
    let fullVisualization = call.fullVisualization!
    const warnings: HumanizerWarning[] = []

    modules.forEach((m) => {
      const res = m(accountOp, fullVisualization, options)
      fullVisualization = res[0]
      warnings.push(...res[1])
      asyncOps.push(...res[2])
    })
    return { ...call, fullVisualization, warnings }
  })
  return [newCalls, asyncOps]
}

export function parseMessage(
  message: IrMessage,
  modules: HumanizerParsingModule[],
  options?: any
): [IrMessage, Promise<HumanizerFragment | null>[]] {
  const asyncOps: Promise<HumanizerFragment | null>[] = []

  let fullVisualization = message.fullVisualization!
  const warnings: HumanizerWarning[] = []

  modules.forEach((m) => {
    const res = m(message, message.fullVisualization!, options)
    fullVisualization = res[0]
    warnings.push(...res[1])
    asyncOps.push(...res[2])
  })

  return [{ ...message, fullVisualization, warnings }, asyncOps]
}
