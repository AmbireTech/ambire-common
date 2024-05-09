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

// @TODO separate output actions for approve and revoke, so we need a special parser for approvals


// @TODO: import from common
// @TODO call the entire module parser
type NetworkId = string

interface TokenInParsedAction {
	// nothing other than an address and network, retrieving meta is the responsibility of the token component + service
	address: string,
	amount: bigint,
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

// What are the special addrs, 0x000...002 ?
// from uni code at https://github.com/Uniswap/universal-router/blob/main/contracts/libraries/Constants.sol (commmit 1cde151b29f101cb06c0db4a2afededa864307b3)
/// @dev Used as a flag for identifying the transfer of ETH instead of a token
// address internal constant ETH = address(0);
/// @dev Used as a flag for identifying that msg.sender should be used, saves gas by sending more 0 bytes
// address internal constant MSG_SENDER = address(1);
/// @dev Used as a flag for identifying address(this) should be used, saves gas by sending more 0 bytes
// address internal constant ADDRESS_THIS = address(2);

if (parsed) {
	const abiCoder = new AbiCoder()
	const commandArgs = parsed.args[1]
	const commands = Buffer.from(parsed.args[0].slice(2), 'hex')
	// @TODO: ugly hack for the path to get in/out: .slice(0, 42), slice(-40)
	// @TODO post-processing: WETH, merging swaps
	const mapped = [...commands].map((cmdRaw, idx) => {
		// first bit is flag whether to allow the command to revert
		const cmd = cmdRaw & 0b01111111
		if (cmd === 0 || cmd === 1 || cmd === 8 || cmd === 9) {
			const isExactIn = cmd === 0 || cmd === 8
			const isV2 = cmd === 8 || cmd === 9
			const pathType =  isV2 ? 'address[0]' : 'bytes'
			// last arg is whether tokens are in the router, we don't care much about this
			// @TODO we need to care about this if we do WETH?
			// @TODO recipient
			const [recipient, amount1, amount2, path, ] =  abiCoder.decode(['address', 'uint256', 'uint256', pathType, 'bool'], commandArgs[idx])
			const tokenIn = isV2 ? path[0] : path.slice(0, 42)
			const tokenOut = isV2 ? path[path.length - 1] : '0x' + path.slice(-40)
			return cmd === 0
				? { action: 'swapExactIn', amountIn: amount1, amountOutMin: amount2, tokenIn, tokenOut }
				: { action: 'swapExactOut', amountOut: amount1, amountInMax: amount2, tokenIn, tokenOut }
		}
		if (cmd === 1) console.log('v3 swap exact out', abiCoder.decode(['address', 'uint256', 'uint256', 'bytes', 'bool'], commandArgs[idx]))
		if (cmd === 2) console.log('permit2 transferFrom', commandArgs[idx])
		if (cmd === 3) console.log('permit2 transfer batch', commandArgs[idx])
		if (cmd === 4) console.log('sweep', abiCoder.decode(['address', 'address', 'uint256'], commandArgs[idx]))
		if (cmd === 5) console.log('transfer', commandArgs[idx])
		if (cmd === 6) console.log('pay portion', abiCoder.decode(['address', 'address', 'uint256'], commandArgs[idx]))
		if (cmd === 10) console.log('permit2 permit', commandArgs[idx])
		if (cmd === 11) console.log('wrap eth', abiCoder.decode(['address', 'uint256'], commandArgs[idx]))
		if (cmd === 12) console.log('unswap eth', abiCoder.decode(['address', 'uint256'], commandArgs[idx]))

		return null

		// 13 is PERMIT2_TRANSFER_FROM_BATCH
	})
	console.log(mapped)
}