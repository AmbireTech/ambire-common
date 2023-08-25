import { AccountOp } from '../../accountOp/accountOp'
import { Ir } from '../interfaces'
import { shortenAddress } from '../utils'

const getName = (address: string, humanizerMeta: any) => {
  if (humanizerMeta[`addressBook:${address}`]) return humanizerMeta[`addressBook:${address}`]
  if (humanizerMeta[`names:${address}`]) return humanizerMeta[`names:${address}`]
  //   if (humanizerMeta[`tokens:${address}`]) return `${humanizerMeta[`tokens:${address}`][0]} contract`
  return null
}
// adds 'name' proeprty to visualization of addresses (needs initialHumanizer to work on unparsed transactions)
export function nameParsing(
  accountOp: AccountOp,
  currentIr: Ir,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
): [Ir, Array<Promise<any>>] {
  const asyncOps: Array<Promise<any>> = []
  const newCalls = currentIr.calls.map((call) => {
    const newVisualization = call.fullVisualization?.map((v: any) => {
      if (v.type === 'address' && !v.name)
        return {
          ...v,
          name: getName(v.address, accountOp.humanizerMeta) || shortenAddress(v.address)
        }
      return v
    })
    return { ...call, fullVisualization: newVisualization || call.fullVisualization }
  })
  const newIr = { ...currentIr, calls: newCalls }
  return [newIr, asyncOps]
}
