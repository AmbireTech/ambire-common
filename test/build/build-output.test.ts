import path from 'path'

import ts from 'typescript'

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
})