import {
  HumanizerParsingModule,
  HumanizerSettings,
  HumanizerVisualization,
  HumanizerWarning
} from '../interfaces'
import { getKnownName, getWarning, shortenAddress } from '../utils'

// adds 'name' proeprty to visualization of addresses (needs initialHumanizer to work on unparsed transactions)
// @TODO name parsing should be no more
// @TODO name should be replaced with humanizerMeta
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
        // console.log(humanizerSettings.humanizerMeta?.knownAddresses[v.address!])
        const newName = getKnownName(humanizerSettings.humanizerMeta, v.address!)
        if (!newName) warnings.push(getWarning('Unknown address'))
        // @TODO remove name property and replace it with knownData in the future
        return {
          ...v,
          name: newName || shortenAddress(v.address!)
        }
      }
      return v
    }
  )
  return [fullVisualization, warnings, []]
}
