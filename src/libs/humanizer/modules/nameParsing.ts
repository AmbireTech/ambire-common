import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../interfaces'
import { shortenAddress } from '../utils'

const getName = (address: string, humanizerMeta: any) => {
  if (humanizerMeta[`addressBook:${address}`]) return humanizerMeta[`addressBook:${address}`]
  if (humanizerMeta[`names:${address}`]) return humanizerMeta[`names:${address}`]
  //   if (humanizerMeta[`tokens:${address}`]) return `${humanizerMeta[`tokens:${address}`][0]} contract`
  return null
}
// adds 'name' proeprty to visualization of addresses (needs initialHumanizer to work on unparsed transactions)
export const nameParsing: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  //   const asyncOps: Array<Promise<HumanizerFragment>> = []
  const newCalls = currentIrCalls.map((call) => {
    const newVisualization = call?.fullVisualization?.map((v: HumanizerVisualization) => {
      if (v.type === 'address' && !v.name)
        return {
          ...v,
          name:
            getName(v.address as string, accountOp.humanizerMeta) ||
            shortenAddress(v.address as string)
        }
      return v
    })
    return { ...call, fullVisualization: newVisualization || call?.fullVisualization }
  })
  return [newCalls, []]
}
