import { ErrorRef } from '../../controllers/eventEmitter/eventEmitter'
import { Message, PlainTextMessage } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerMeta,
  HumanizerPromise,
  HumanizerTypedMessageModule,
  IrCall,
  IrMessage
} from './interfaces'
import { getAction, getHumanMessage, integrateFragments } from './utils'

export function humanizeCalls(
  _accountOp: AccountOp,
  humanizerModules: HumanizerCallModule[],
  _humanizerMeta: HumanizerMeta,
  options?: any
): [IrCall[], HumanizerPromise[], ErrorRef | null] {
  let error = null
  const accountOp = {
    ..._accountOp,
    calls: _accountOp.calls.map((c) => ({ ...c, to: c.to }))
  }
  const humanizerMeta = integrateFragments(_humanizerMeta, accountOp.humanizerMetaFragments || [])

  let currentCalls: IrCall[] = accountOp.calls
  let asyncOps: HumanizerPromise[] = []
  try {
    humanizerModules.forEach((hm) => {
      let newPromises = []
      ;[currentCalls, newPromises] = hm(accountOp, currentCalls, humanizerMeta, options)
      asyncOps = [...asyncOps, ...newPromises]
    })
  } catch (e: any) {
    error = {
      message: 'Humanizer: unexpected err',
      error: e as Error,
      level: 'major' as ErrorRef['level']
    }
  }
  return [currentCalls, asyncOps, error]
}
export const humanizeTypedMessage = (
  modules: HumanizerTypedMessageModule[],
  tm: Message
  // only fullVisualization and warnings
): Omit<IrMessage, keyof Message> => {
  // runs all modules and takes the first non empty array
  const { fullVisualization, warnings } = modules
    .map((m) => m(tm))
    .filter((p) => p.fullVisualization?.length)[0]
  return { fullVisualization, warnings }
}

export const humanizePlainTextMessage = (
  m: PlainTextMessage
  // only full visualization and warnings
): Omit<IrMessage, keyof Message> => ({
  fullVisualization: [getAction('Sign message:'), getHumanMessage(m.message)],
  warnings: []
})
