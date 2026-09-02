import { DERIVATION_OPTIONS, HD_PATH_TEMPLATE_TYPE } from '../consts/derivation'

export const getHdPathFromTemplate = (hdPathTemplate: HD_PATH_TEMPLATE_TYPE, index: number) => {
  return hdPathTemplate.replace('<account>', index.toString())
}

export const getParentHdPathFromTemplate = (hdPathTemplate: HD_PATH_TEMPLATE_TYPE) => {
  return hdPathTemplate.split('/<account>')[0]
}

export const getHdPathWithoutRoot = (hdPath: string) => hdPath.slice(2)

const HARDENED_OFFSET = 0x80000000
export const getHDPathIndices = (hdPathTemplate: HD_PATH_TEMPLATE_TYPE, insertIdx = 0) => {
  const path = hdPathTemplate.split('/').slice(1)
  const indices = []
  let usedX = false
  path.forEach((_idx) => {
    const isHardened = _idx[_idx.length - 1] === "'"
    let idx = isHardened ? HARDENED_OFFSET : 0
    // If there is an `<account>` in the path string, we will use it to insert our
    // index. This is useful for e.g. Ledger Live path. Most paths have the
    // changing index as the last one, so having an `<account>` in the path isn't
    // usually necessary.
    if (_idx.indexOf('<account>') > -1) {
      idx += insertIdx
      usedX = true
    } else if (isHardened) {
      idx += Number(_idx.slice(0, _idx.length - 1))
    } else {
      idx += Number(_idx)
    }
    indices.push(idx)
  })
  // If this path string does not include an `<account>`, we just append the index
  // to the end of the extracted set
  if (usedX === false) {
    indices.push(insertIdx)
  }
  // Sanity check -- Lattice firmware will throw an error for large paths
  if (indices.length > 5) throw new Error('Only HD paths with up to 5 indices are allowed.')
  return indices
}

/**
 * The part of an HD path template that is relative to `originPath` - the path an
 * extended public key was exported from. Returns null when the template does not
 * branch off the origin (e.g. a hardened account index), meaning that extended
 * public key cannot derive it.
 */
export const getHdPathTemplateRelativeToOrigin = (
  originPath: string,
  hdPathTemplate: HD_PATH_TEMPLATE_TYPE
) => {
  const originLevels = originPath.split('/')
  const templateLevels = hdPathTemplate.split('/')

  if (templateLevels.length <= originLevels.length) return null
  if (originLevels.some((level, i) => level !== templateLevels[i])) return null

  return templateLevels.slice(originLevels.length).join('/')
}

/**
 * Which of the offered derivation paths an extended public key exported from
 * `originPath` can browse. Wallets that hand over a single extended public key
 * (QR, NFC) are limited to these.
 */
export const getDerivableHdPathTemplates = (originPath: string) =>
  DERIVATION_OPTIONS.map(({ value }) => value).filter(
    (template) => !!getHdPathTemplateRelativeToOrigin(originPath, template)
  )
