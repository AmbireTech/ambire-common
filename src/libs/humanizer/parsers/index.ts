import { AccountOp } from '../../accountOp/accountOp'
import {
  HumanizerFragment,
  HumanizerParsingModule,
  HumanizerSettings,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall,
  IrMessage
} from '../interfaces'

const runModules = (
  _visualization: HumanizerVisualization[],
  settings: HumanizerSettings,
  modules: HumanizerParsingModule[],
  options?: any
): [HumanizerVisualization[], HumanizerWarning[], Promise<HumanizerFragment | null>[]] => {
  const warnings: HumanizerWarning[] = []
  const asyncOps: Promise<HumanizerFragment | null>[] = []

  let visualization = _visualization
  modules.forEach((m) => {
    const res = m(settings, visualization, options)
    visualization = res[0]
    warnings.push(...res[1])
    asyncOps.push(...res[2])
  })
  return [visualization, warnings, asyncOps]
}

// eslint-disable-next-line class-methods-use-this
export function parseCalls(
  accountOp: AccountOp,
  calls: IrCall[],
  modules: HumanizerParsingModule[],
  options?: any
): [IrCall[], Promise<HumanizerFragment | null>[]] {
  const asyncOps: Promise<HumanizerFragment | null>[] = []
  const newCalls = calls.map((call) => {
    const humanizerSettings: HumanizerSettings = {
      accountAddr: accountOp.accountAddr,
      networkId: accountOp.networkId,
      humanizerMeta: accountOp.humanizerMeta
    }

    const [fullVisualization, warnings, callAsyncOps] = runModules(
      call.fullVisualization!,
      humanizerSettings,
      modules,
      options
    )
    asyncOps.push(...callAsyncOps)
    return { ...call, fullVisualization, warnings }
  })
  return [newCalls, asyncOps]
}

export function parseMessage(
  humanizerSettings: HumanizerSettings,
  message: IrMessage,
  modules: HumanizerParsingModule[],
  options?: any
): [IrMessage, Promise<HumanizerFragment | null>[]] {
  const [fullVisualization, warnings, asyncOps] = runModules(
    message.fullVisualization!,
    humanizerSettings,
    modules,
    options
  )
  return [{ ...message, fullVisualization, warnings }, asyncOps]
}
