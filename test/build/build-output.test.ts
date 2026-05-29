import path from 'path'
import fs from 'fs'

import ts from 'typescript'

import { getRelativeAliasSpecifier, rewriteAliasSpecifiers } from '../../scripts/rewriteDistAliases'

const repoRoot = path.resolve(__dirname, '../..')
const tsconfigPath = path.join(repoRoot, 'tsconfig.build.json')

function getBuildCompilerOptions() {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile)

  if (configFile.error) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext([configFile.error], {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => repoRoot,
      getNewLine: () => '\n'
    }))
  }

  return ts.parseJsonConfigFileContent(configFile.config, ts.sys, repoRoot).options
}

describe('tsconfig.build.json', () => {
  test('emits CommonJS output for relative imports', () => {
    const compilerOptions = getBuildCompilerOptions()
    const source = "import { PIMLICO } from './bundlers'\nexport const bundler = PIMLICO\n"

    const output = ts.transpileModule(source, {
      compilerOptions,
      fileName: path.join(repoRoot, 'test/build/fixture.ts')
    }).outputText

    expect(compilerOptions.module).toBe(ts.ModuleKind.CommonJS)
    expect(output).toContain('require("./bundlers")')
    expect(output).not.toContain("from './bundlers'")
  })

  test('emits CommonJS output for JSON imports', () => {
    const compilerOptions = getBuildCompilerOptions()
    const source = "import abi from './Safe.json'\nexport default abi\n"

    const output = ts.transpileModule(source, {
      compilerOptions,
      fileName: path.join(repoRoot, 'test/build/fixture.ts')
    }).outputText

    expect(output).toContain('require("./Safe.json")')
    expect(output).not.toContain("import abi from './Safe.json'")
  })

  test('runs alias rewriting as part of build:v2', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

    expect(packageJson.scripts['build:v2']).toContain('node scripts/rewriteDistAliases.js')
  })

  test('rewrites aliased specifiers to relative dist paths', () => {
    const filePath = path.join(repoRoot, 'dist/src/services/ensDomains/ensDomains.js')
    const source = 'const provider = require("@/services/provider")\n'

    const output = rewriteAliasSpecifiers(source, filePath)

    expect(output).toContain('require("../provider")')
    expect(output).not.toContain('@/services/provider')
  })

  test('keeps non-aliased specifiers unchanged', () => {
    const filePath = path.join(repoRoot, 'dist/src/services/ensDomains/ensDomains.js')
    const source = 'const provider = require("../../services/provider")\nconst label = "@not-a-module"\n'

    const output = rewriteAliasSpecifiers(source, filePath)

    expect(output).toBe(source)
  })

  test('rewrites aliases correctly from dist/v1 files', () => {
    const filePath = path.join(repoRoot, 'dist/v1/hooks/usePortfolio.js')

    expect(getRelativeAliasSpecifier(filePath, '@/services/provider')).toBe('../../src/services/provider')
  })
})