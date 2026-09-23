/** Thrown by services on bad input or a failed precondition; `status` is an HTTP status. */
export class ServiceError extends Error {
	readonly name = 'ServiceError';
	constructor(
		message: string,
		readonly status: number = 400
	) {
		super(message);
	}
}

export function notFound(what: string): ServiceError {
	return new ServiceError(`${what} not found`, 404);
}
