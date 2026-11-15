// RFC 10008 approach: search via the QUERY method, with the query in the body.
// Safe + idempotent like GET, but carries a body like POST.
//
// Requires Node >= 21.7.2 (llhttp 9.2.0 added QUERY to the parser).
//
// Try it:
//   curl -X QUERY http://localhost:3001/contacts \
//     -H "Content-Type: application/json" \
//     -d '{"match": "example.com", "limit": 2, "select": ["surname", "email"]}'
//
// RFC 10008 behaviors demonstrated here:
//   - Content-Type is mandatory: missing -> 400, unsupported -> 415
//   - Unprocessable query content -> 422
//   - Accept-Query response header advertises supported query media types
//   - OPTIONS lists QUERY in Allow for discovery

import { Logger } from "../utils/logger.js";
import { createServer, type IncomingMessage } from "node:http";
import { runQuery, type ContactQuery } from "../lib/contacts.ts";

const logger = new Logger({
	directory: 'src/logs',
	filename: 'query-server.log'
})

const PORT = process.env.QUERY_PORT ?? 3001;
const QUERY_MEDIA_TYPE = "application/json";

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

function isContactQuery(value: unknown): value is ContactQuery {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}

	const query = value as Record<string, unknown>;
	return (
		(query.match === undefined || typeof query.match === "string") &&
		(query.limit === undefined ||
			(typeof query.limit === "number" && Number.isFinite(query.limit))) &&
		(query.select === undefined ||
			(Array.isArray(query.select) &&
				query.select.every((field) => typeof field === "string")))
	);
}

// Initialize logging infrastructure before accepting requests.
createServer(async (req, res) => {
	await logger.initialize();

	// Register request lifecycle logging.
	logger.request(req, res);

	// Your API routing logic.
	const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

	if (url.pathname !== "/contacts") {
		res.writeHead(404).end("Not Found\n");
		return;
	}

	if (req.method === "OPTIONS") {
		res
			.writeHead(204, {
				Allow: "QUERY, OPTIONS",
				"Accept-Query": QUERY_MEDIA_TYPE,
			})
			.end();
		return;
	}

	if (req.method !== "QUERY") {
		res
			.writeHead(405, {
				Allow: "QUERY, OPTIONS",
				"Accept-Query": QUERY_MEDIA_TYPE,
			})
			.end("Method Not Allowed - this resource is queried via QUERY\n");
		return;
	}

	// RFC 10008 §2.1: servers MUST fail the request if Content-Type is missing.
	const contentType = req.headers["content-type"]?.split(";")[0]?.trim();

	if (!contentType) {
		res.writeHead(400).end("Bad Request: Content-Type is required for QUERY\n");
		return;
	}

	if (contentType !== QUERY_MEDIA_TYPE) {
		res
			.writeHead(415, { "Accept-Query": QUERY_MEDIA_TYPE })
			.end(`Unsupported Media Type: expected ${QUERY_MEDIA_TYPE}\n`);
		return;
	}

	let body: string;
	try {
		body = await readBody(req);
	} catch {
		res.writeHead(400).end("Bad Request: could not read request body\n");
		return;
	}

	let query: unknown;

	try {
		query = JSON.parse(body);
	} catch {
		// RFC 10008 §2.1: declared type is right but content can't be processed.
		res.writeHead(422).end("Unprocessable Content: body is not valid JSON\n");
		return;
	}
	if (!isContactQuery(query)) {
		res.writeHead(422).end("Unprocessable Content: invalid query shape\n");
		return;
	}

	const results = runQuery(query);
	res
		.writeHead(200, {
			"Content-Type": QUERY_MEDIA_TYPE,
			"Accept-Query": QUERY_MEDIA_TYPE,
		})
		.end(JSON.stringify({ results }, null, 2) + "\n");

	void logger.flush();
}).listen(PORT, () => {
	console.log(
		`QUERY server:  http://localhost:${PORT}/contacts (send QUERY with a JSON body)`,
	);
});
