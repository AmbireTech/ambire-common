const fs = require('fs')
const path = require('path')
const { compile } = require('../src/libs/deployless/compile')

const rootDir = path.resolve(__dirname, '..')
const contractsDir = `${rootDir}/contracts/deployless`
const outputDir = `${rootDir}/contracts/compiled`

// Extract all file paths from a `dir` in a flat way.
// It doesn't support child folders, as we don't need it for now.
async function walk(dir) {
  let files = await fs.promises.readdir(dir)
  files = await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(dir, file)

      return filePath
    })
  )

  return files.filter((file) => file.slice(-4) === '.sol')
}

async function run() {
  const files = await walk(contractsDir)

  console.log('📜 Contracts found: ', files)

  files.forEach((file) => {
    let contractName = file.split('/').slice(-1)[0]
    // it removes .sol from contract name
    contractName = contractName.slice(0, contractName.length - 4)

    const output = compile(contractName, {
      contractsFolder: contractsDir
    })

    fs.writeFileSync(`${outputDir}/${contractName}.json`, JSON.stringify(output))

    console.log(`✅ ${contractName} compiled successfully!`)
  })
}

run()
