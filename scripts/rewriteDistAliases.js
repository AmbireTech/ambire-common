const fs = require('fs')
const path = require('path')

const DIST_ROOT = path.resolve(__dirname, '../dist')
const ALIAS_PREFIX = '@/'
const ALIAS_ROOT = path.join(DIST_ROOT, 'src')

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/')
}

function ensureRelativeSpecifier(specifier) {
  return specifier.startsWith('.') ? specifier : `./${specifier}`
}

function getRelativeAliasSpecifier(filePath, specifier) {
  if (!specifier.startsWith(ALIAS_PREFIX)) return specifier

  const aliasTarget = path.join(ALIAS_ROOT, specifier.slice(ALIAS_PREFIX.length))
  const relativePath = path.relative(path.dirname(filePath), aliasTarget)

  return ensureRelativeSpecifier(toPosixPath(relativePath))
}

function rewriteAliasSpecifiers(content, filePath) {
  let output = ''

  for (let index = 0; index < content.length; index += 1) {
    const currentChar = content[index]

    if (currentChar !== '"' && currentChar !== "'") {
      output += currentChar
      continue
    }

    let literalEnd = index + 1

    while (literalEnd < content.length) {
      const literalChar = content[literalEnd]

      if (literalChar === '\\') {
        literalEnd += 2
        continue
      }

      if (literalChar === currentChar) break

      literalEnd += 1
    }

    if (literalEnd >= content.length) {
      output += content.slice(index)
      break
    }

    const literalValue = content.slice(index + 1, literalEnd)
    const rewrittenValue = literalValue.startsWith(ALIAS_PREFIX)
      ? getRelativeAliasSpecifier(filePath, literalValue)
      : literalValue

    output += `${currentChar}${rewrittenValue}${currentChar}`
    index = literalEnd
  }

  return output
}

function shouldRewriteFile(fileName) {
  return fileName.endsWith('.js') || fileName.endsWith('.d.ts')
}

function collectDistFiles(directoryPath) {
  const dirents = fs.readdirSync(directoryPath, { withFileTypes: true })

  return dirents.flatMap((dirent) => {
    const entryPath = path.join(directoryPath, dirent.name)

    if (dirent.isDirectory()) return collectDistFiles(entryPath)
    if (!shouldRewriteFile(dirent.name)) return []

    return [entryPath]
  })
}

function rewriteDistAliases(distRoot = DIST_ROOT) {
  if (!fs.existsSync(distRoot)) {
    throw new Error(`Cannot rewrite dist aliases because ${distRoot} does not exist`)
  }

  const files = collectDistFiles(distRoot)
  let rewrittenFiles = 0

  files.forEach((filePath) => {
    const currentContent = fs.readFileSync(filePath, 'utf8')
    const rewrittenContent = rewriteAliasSpecifiers(currentContent, filePath)

    if (rewrittenContent === currentContent) return

    fs.writeFileSync(filePath, rewrittenContent)
    rewrittenFiles += 1
  })

  return rewrittenFiles
}

if (require.main === module) {
  const rewrittenFiles = rewriteDistAliases()
  console.log(`Rewrote aliased imports in ${rewrittenFiles} dist files.`)
}

module.exports = {
  ALIAS_PREFIX,
  ALIAS_ROOT,
  collectDistFiles,
  getRelativeAliasSpecifier,
  rewriteAliasSpecifiers,
  rewriteDistAliases
}