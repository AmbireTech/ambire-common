import { Interface, toBigInt, hexlify } from 'ethers'
import { AbiCoder } from 'ethers'
import fetch from 'node-fetch'
import { readFile, exists } from 'fs'
import { promisify } from 'util'
const _readFile = promisify(readFile)
const _exists = promisify(exists)

async function fetchJson (url: string, body: object, args: object = {}) {
	const headers = { 'Content-Type': 'application/json' }
	const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers, ...args })
	return res.json()
}

async function fetchRpc(url: string, method: string, params: any[] = []) {
	// @TODO: fix any?
	const response: any = await fetchJson(url, { method, params, id: 1, jsonrpc: '2.0' })
	// @TODO is this the right way to handle errors; this should be ok?
	if (response.error) throw response.error
	return response.result
}

// @TODO dynamic URL
const url = 'https://invictus.ambire.com/ethereum'
async function scrapeSignatures () {
	const mostFrequent = new Map()
	const latestBlock = toBigInt(await fetchRpc(url, 'eth_blockNumber'))
	for (let i = latestBlock - 1000n; i <= latestBlock; i++) {
		const block = await fetchRpc(url,'eth_getBlockByNumber', ['0x'+i.toString(16), true])
		for (const txn of block.transactions) { 
			if (txn.input.length >= 10) {
				const sig = txn.input.slice(2, 10)
				mostFrequent.set(sig, (mostFrequent.get(sig) ?? 0) + 1)
			}
		}
	}
	const sorted = [...mostFrequent.entries()].sort((a,b) => b[1] - a[1])
	const signatures = await Promise.all(sorted.slice(0, 2500).map(async ([sigHash, hits]) => {
		const path = `/home/ivo/storage/repos/4bytes/signatures/${sigHash}`
		const exists = await _exists(path)
		const sig = exists ? (await _readFile(path)).toString() : null
		return sig && [sig, sigHash, hits]
	}))
  const signaturesFiltered = signatures.filter(x => x)

	console.log(JSON.stringify(signaturesFiltered))
}

/*
scrapeSignatures()
	.catch((e: any) => console.error(e))

*/

// @TODO: import from common
// @TODO call the entire module parser
type NetworkId = string

interface TokenInParsedAction {
	// nothing other than an address and network, retrieving meta is the responsibility of the token component + service
	address: string,
	networkId: NetworkId,
	role?: string,
}

interface InteracteeInParsedAction {
	address: string,
	role?: string
}

// Designed to be used together with Call or Message, however for each Call/Message there could be an array of ParsedAction
interface ParsedAction {
	actionName: string,
	interactedWith: InteracteeInParsedAction[],
	tokens: TokenInParsedAction[]
}

const iface = new Interface(['function execute(bytes,bytes[],uint256)'])
const parsed = iface.parseTransaction({
  data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000066229ac300000000000000000000000000000000000000000000000000000000000000040b000604000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000280000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000001906999cbae477f0296c00000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002bc02aaa39b223fe8d0a0e5c4f27ead9083c756cc200271088800092ff476844f74dc2fc427974bbee2794ae000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000088800092ff476844f74dc2fc427974bbee2794ae00000000000000000000000037a8f295612602f2774d331e562be9e61b83a3270000000000000000000000000000000000000000000000000000000000000019000000000000000000000000000000000000000000000000000000000000006000000000000000000000000088800092ff476844f74dc2fc427974bbee2794ae0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000001906999cbae477f0296c',
  value: 1000000000000000000n
})

if (parsed) {
	const abiCoder = new AbiCoder()
	const commandArgs = parsed.args[1]
	const commands = Buffer.from(parsed.args[0].slice(2), 'hex')
	// @TODO: bitmask, handle flags
	for (const [idx, cmdRaw] of commands.entries()) {
		const cmd = cmdRaw & 0b01111111
		if (cmd === 0) console.log('v3 swap exact in', abiCoder.decode(['address', 'uint256', 'uint256', 'bytes', 'bool'], commandArgs[idx]))
		if (cmd === 1) console.log('v3 swap exact out', abiCoder.decode(['address', 'uint256', 'uint256', 'bytes', 'bool'], commandArgs[idx]))
		if (cmd === 2) console.log('permit2 transferFrom', commandArgs[idx])
		if (cmd === 3) console.log('permit2 transfer batch', commandArgs[idx])
		if (cmd === 4) console.log('sweep', abiCoder.decode(['address', 'address', 'uint256'], commandArgs[idx]))
		if (cmd === 5) console.log('transfer', commandArgs[idx])
		if (cmd === 6) console.log('pay portion', abiCoder.decode(['address', 'address', 'uint256'], commandArgs[idx]))
		if (cmd === 8) console.log('v2 swap exact in', abiCoder.decode(['address', 'uint256', 'uint256', 'address[]', 'bool'], commandArgs[idx]))
		if (cmd === 9) console.log('v2 swap exact out', abiCoder.decode(['address', 'uint256', 'uint256', 'address[]', 'bool'], commandArgs[idx]))
		if (cmd === 10) console.log('permit2 permit', commandArgs[idx])
		if (cmd === 11) console.log('wrap eth', abiCoder.decode(['address', 'uint256'], commandArgs[idx]))
		if (cmd === 12) console.log('unswap eth', abiCoder.decode(['address', 'uint256'], commandArgs[idx]))
		// 13 is PERMIT2_TRANSFER_FROM_BATCH

	}
}