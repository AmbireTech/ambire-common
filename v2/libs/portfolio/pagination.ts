export function paginate (input: any[], limit: number): any[][] {
	let pages = []
	let from = 0
	for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
		pages.push(input.slice(from, i * limit))
		from += limit
	}
	return pages
}

export async function flattenResults(everything: Promise<any[]>[]): Promise<any[]> {
	return Promise.all(everything).then(results => results.flat())
}
