interface QueueElement {
	resolve: Function,
	reject: Function,
	fetch: Function,
	accountId: string,
	networkId: string,
	velcroUrl: string
}
let queue: QueueElement[] = []
export default function batchedVelcro (fetch: Function, velcroUrl: string, networkId: string, accountId: string): Promise<any> {
	// always do the setTimeout - if it's a second or third batchedCall within a tick, all setTimeouts will fire but only the first will perform work
	setTimeout(resolveQueue, 0)
	return new Promise((resolve, reject) => queue.push({ resolve, reject, fetch, accountId, networkId, velcroUrl }))
}

async function resolveQueue() {
	// Note: intentionally just using the first values in the queue
	if (queue.length === 0) return
	const { fetch, velcroUrl } = queue[0]
	try {
		const url = `${velcroUrl}/velcro-v3/multi-hints?networks=${queue.map(x => x.networkId).join(',')}&accounts=${queue.map(x => x.accountId).join(',')}`
		const resp = await fetch(url)
		const body = await resp.json()
		if (body.length !== queue.length) throw new Error('internal error: incorrect velcro v3 response length for multiple hints')
		queue.forEach(({ resolve }, i) => resolve(body[i]))
	} catch (e) { queue.forEach(({ reject }) => reject(e)) }
	queue = []
}
