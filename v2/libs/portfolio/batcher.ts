interface QueueElement {
	resolve: Function,
	reject: Function,
	fetch: Function,
	data: any
}

export default function batcher (fetch: Function, urlGenerator: (queue: any[]) => string): Function {
	let queue: QueueElement[] = []
	async function resolveQueue() {
		// Note: intentionally just using the first values in the queue
		if (queue.length === 0) return
		try {
			const url = urlGenerator(queue.map(x => x.data))
			const resp = await fetch(url)
			const body = await resp.json()
			if (!Array.isArray(body) || body.hasOwnProperty('message')) throw body
			if (body.length !== queue.length) throw new Error('internal error: queue length and response length mismatch')
			queue.forEach(({ resolve }, i) => resolve(body[i]))
		} catch (e) { queue.forEach(({ reject }) => reject(e)) }
		queue = []
	}
	return async (data: any): Promise<any> => {
		// always do the setTimeout - if it's a second or third batchedCall within a tick, all setTimeouts will fire but only the first will perform work
		setTimeout(resolveQueue, 0)
		return new Promise((resolve, reject) => queue.push({ resolve, reject, fetch, data }))
	}
}
