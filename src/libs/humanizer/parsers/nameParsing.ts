import {
  HumanizerParsingModule,
  HumanizerSettings,
  HumanizerVisualization,
  HumanizerWarning
} from '../interfaces'
import { getWarning, shortenAddress } from '../utils'

const getName = (address: string, humanizerMeta: any) => {
  if (humanizerMeta[`addressBook:${address}`]) return humanizerMeta[`addressBook:${address}`]
  if (humanizerMeta[`names:${address}`]) return humanizerMeta[`names:${address}`]
  //   if (humanizerMeta[`tokens:${address}`]) return `${humanizerMeta[`tokens:${address}`][0]} contract`
  return null
}
// adds 'name' proeprty to visualization of addresses (needs initialHumanizer to work on unparsed transactions)
export const nameParsing: HumanizerParsingModule = (
  humanizerSettings: HumanizerSettings,
  visualization: HumanizerVisualization[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const warnings: HumanizerWarning[] = []
  const fullVisualization: HumanizerVisualization[] = visualization.map(
    (v: HumanizerVisualization) => {
      if (v.type === 'address' && !v.name) {
        const newName = getName(v.address as string, humanizerSettings.humanizerMeta)
        if (!newName)
          // eslint-disable-next-line no-param-reassign
          warnings.push(getWarning('Unknown address'))
        return {
          ...v,
          name: newName || shortenAddress(v.address as string)
        }
      }
      return v
    }
  )
  return [fullVisualization, warnings, []]
}
