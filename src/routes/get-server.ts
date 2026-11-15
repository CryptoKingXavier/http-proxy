// Classic approach: search via GET, with the query checked in the URL.
//
// Try it:
//   curl "http://localhost:3000/contacts?match=example.com&limit=2&select=surname"
//
// Downsides QUERY was designed to fix:
//   - the whole query lives in the URI (length limits, shows up in logs/history - cacheable)
//   - complex queries must be shoehorned into URL encoding

import { createServer } from "node:http";
import { Logger } from "../utils/logger.ts";
import { runQuery, type Contact, type ContactQuery } from "../lib/contacts.ts";

const logger = new Logger({
	directory: 'src/logs',
	filename: 'get-server.log'
})

const PORT = process.env.GET_PORT ?? 3000;
const QUERY_MEDIA_TYPE = "application/json";

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

	if (req.method !== "GET") {
		res.writeHead(405, { Allow: "GET" }).end("Method Not Allowed\n");
		return;
	}

	const select = url.searchParams.get("select");
	const query: ContactQuery = {
		match: url.searchParams.get("match") ?? undefined,
		limit: url.searchParams.has("limit")
			? Number(url.searchParams.get("limit"))
			: undefined,
		select: select === null ? undefined : select.split(/[.,]/),
	};

	const results = runQuery(query);
	res
		.writeHead(200, { "Content-Type": QUERY_MEDIA_TYPE })
		.end(JSON.stringify({ results }, null, 2) + "\n");

	void logger.flush();
}).listen(PORT, () => {
	console.log(
		`GET server:  http://localhost:${PORT}/contacts?match=example.com&limit=2`,
	);
});
