/* eslint-disable no-console */
/* eslint-disable no-continue */
/* eslint-disable no-await-in-loop */
const fs = require('fs').promises
const path = require('path')

const rootDir = path.resolve(__dirname, '..')
const startDir = `${rootDir}/artifacts/contracts`
const outputDir = `${rootDir}/contracts/compiled`
let contractsToCompile = []

async function moveContractsFromDir(dir) {
  console.log('🕛 Searching in', dir)

  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (let i = 0; i < entries.length; i++) {
    if (!contractsToCompile.length) return
    const entry = entries[i]
    const { name, path: folderPath } = entry

    if (!name.endsWith('.sol') && entry.isDirectory()) {
      await moveContractsFromDir(entry.path)
      continue
    }
    if (!name.endsWith('.sol') || !entry.isDirectory()) continue

    const filesInFolder = await fs.readdir(folderPath, { withFileTypes: true })
    for (let j = 0; j < filesInFolder.length; j++) {
      const f = filesInFolder[j]

      if (f.isDirectory()) continue
      if (f.name.endsWith('.dbg.json') || !f.name.endsWith('.json')) continue

      const { abi, bytecode, deployedBytecode } = await fs
        .readFile(f.path, 'utf-8')
        .then(JSON.parse)

      const outputFile = `${outputDir}/${f.name}`
      const dataToWrite = JSON.stringify(
        { abi, bin: bytecode, binRuntime: deployedBytecode },
        null,
        4
      )
      const pureFilename = f.name.split('.json')[0]

      if (contractsToCompile.includes(pureFilename)) {
        await fs.writeFile(outputFile, dataToWrite)

        const indexOfRequestedContract = contractsToCompile.indexOf(pureFilename)
        contractsToCompile.splice(indexOfRequestedContract, 1)

        console.log(`📜 Wrote ${f.name}`, pureFilename)
      }
    }
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log(
      '❗❗❗ No contract name passed for compilation. You should pass at least one as argument to the script!'
    )
    return
  }

  contractsToCompile = process.argv.slice(2)

  await moveContractsFromDir(startDir)

  if (contractsToCompile.length)
    console.log(`❌ Failed to find ${contractsToCompile.length} contracts: `, contractsToCompile)
  else console.log('✅ Done')
}

main().catch(console.error)
