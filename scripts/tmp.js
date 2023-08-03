const fs = require('fs')
const path = require('path')

function csvToJson(csvFilePath) {
  const jsonArray = {}
  const csvData = fs.readFileSync(csvFilePath, 'utf-8')
  const rows = csvData.trim().split('\n')

  const headers = rows.shift().split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)

  for (const row of rows) {
    const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)

    const text = cols[0].trim().replace(/^"(.*)"$/, '$1')
    const hash = cols[1].trim().replace(/^"(.*)"$/, '$1')

    jsonArray[hash] = text
  }

  // Write the resulting JSON to a file (optional)
  const jsonFilePath = path.join(__dirname, 'output.json')
  fs.writeFileSync(jsonFilePath, JSON.stringify(jsonArray, null, 2))
  console.log('JSON data has been written to output.json')
}

// Usage example
const csvFilePath = path.join(__dirname, 'example.csv')
csvToJson(csvFilePath)
