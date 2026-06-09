import { Inngest } from 'inngest';

export const inngest = new Inngest({
	id: 'lunapad',
	// In Docker Compose, INNGEST_BASE_URL=http://inngest:8288 routes to the inngest service.
	// Locally, INNGEST_DEV=1 defaults to http://127.0.0.1:8288.
	baseUrl: process.env.INNGEST_BASE_URL
});
