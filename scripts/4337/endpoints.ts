import fetch from 'node-fetch'

const options = {
  method: 'POST',
  headers: { accept: 'application/json', 'content-type': 'application/json' },
  body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'eth_supportedEntryPoints' })
}

fetch('https://polygon-mainnet.g.alchemy.com/v2/YC6hEku0Ah6hfnkLjQjKLmMlZFrZsxEp', options)
  .then((response) => response.json())
  .then((response) => console.log(response))
  .catch((err) => console.error(err))
