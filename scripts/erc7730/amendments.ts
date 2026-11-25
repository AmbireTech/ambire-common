import { Amendments } from './amend'

// Ambire's changes to the ERC-7730 registry, applied by `npm run humanizer:update:erc7730Registry`
// (see `./amend.ts` for what each kind of change checks). Ambire's own descriptors are the JSON
// files in `./descriptors`, named by their path there.

export const amendments: Amendments = {
  amendCalldataDescriptors: {},
  addCalldataDescriptors: {},
  amendEip712Descriptors: {},
  addEip712Descriptors: {}
}
