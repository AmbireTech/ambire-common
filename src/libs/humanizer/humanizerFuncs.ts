import { ErrorRef } from '../../controllers/eventEmitter/eventEmitter'
import { Message } from '../../interfaces/userRequest'
import { AccountOp } from '../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerMeta,
  HumanizerTypedMessageModule,
  IrCall,
  IrMessage
} from './interfaces'

export function humanizeCalls(
  _accountOp: AccountOp,
  humanizerModules: HumanizerCallModule[],
  humanizerMeta: HumanizerMeta,
  options?: any
): IrCall[] {
  const accountOp = {
    ..._accountOp,
    calls: _accountOp.calls.map((c) => ({ ...c, to: c.to }))
  }

  let currentCalls: IrCall[] = accountOp.calls
  humanizerModules.forEach((hm) => {
    currentCalls = hm(accountOp, currentCalls, humanizerMeta, options)
  })
  return currentCalls
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
