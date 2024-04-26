import { AccountOp } from '../../accountOp/accountOp'
import {
  HumanizerFragment,
  HumanizerMeta,
  HumanizerParsingModule,
  HumanizerSettings,
  HumanizerVisualization,
  HumanizerWarning,
  IrCall,
  IrMessage
} from '../interfaces'
import { EMPTY_HUMANIZER_META, integrateFragments } from '../utils'

const runModules = (
  _visualization: HumanizerVisualization[],
  settings: HumanizerSettings,
  modules: HumanizerParsingModule[],
  options?: any
): [
  HumanizerVisualization[],
  HumanizerWarning[],
  Array<() => Promise<HumanizerFragment | null>>
] => {
  const warnings: HumanizerWarning[] = []
  const asyncOps: Array<() => Promise<HumanizerFragment | null>> = []

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
  humanizerMeta: HumanizerMeta,
  options?: any
): [IrCall[], Array<() => Promise<HumanizerFragment | null>>] {
  const asyncOps: Array<() => Promise<HumanizerFragment | null>> = []
  const newCalls = calls.map((call) => {
    const humanizerSettings: HumanizerSettings = {
      accountAddr: accountOp.accountAddr,
      networkId: accountOp.networkId,
      humanizerMeta: integrateFragments(humanizerMeta, accountOp.humanizerMetaFragments || [])
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
  settings: HumanizerSettings,
  message: IrMessage,
  modules: HumanizerParsingModule[],
  options?: any
): [IrMessage, Array<() => Promise<HumanizerFragment | null>>] {
  const humanizerSettings: HumanizerSettings = {
    ...settings,
    humanizerMeta: integrateFragments(
      settings.humanizerMeta || EMPTY_HUMANIZER_META,
      message.humanizerFragments || []
    )
  }
  const [fullVisualization, warnings, asyncOps] = runModules(
    message.fullVisualization!,
    humanizerSettings,
    modules,
    options
  )
  return [{ ...message, fullVisualization, warnings }, asyncOps]
}
