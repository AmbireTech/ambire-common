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
		const queueCopy = queue
		queue = []
		try {
			const url = urlGenerator(queueCopy.map(x => x.data))
			const resp = await fetch(url)
			const body = await resp.json()
			if (body.hasOwnProperty('message')) throw body
			if (body.hasOwnProperty('error')) throw body
			if (Array.isArray(body)) {
				if (body.length !== queueCopy.length) throw new Error('internal error: queue length and response length mismatch')
				queueCopy.forEach(({ resolve }, i) => resolve(body[i]))
			} else if (queueCopy.every(x => typeof x.data['responseIdentitier'] === 'string')) {
				queueCopy.forEach(({ resolve, data }) => resolve(body[data.responseIdentifier as string]))
			} else throw body
		} catch (e) { queueCopy.forEach(({ reject }) => reject(e)) }
	}
	return async (data: any): Promise<any> => {
		// always do the setTimeout - if it's a second or third batchedCall within a tick, all setTimeouts will fire but only the first will perform work
		setTimeout(resolveQueue, 0)
		return new Promise((resolve, reject) => queue.push({ resolve, reject, fetch, data }))
	}
}
