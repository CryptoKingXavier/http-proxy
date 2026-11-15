# HTTP GET vs. QUERY Demo

A small TypeScript project that compares a conventional `GET` request, with
search criteria encoded in the URL, to an experimental `QUERY` request, with
the criteria sent as JSON in the request body.

> [!IMPORTANT]
> Despite the repository/package name, this project does **not** implement an
> HTTP forward or reverse proxy. It runs two local demo servers over a static,
> in-memory contacts list. It is an educational example, not a production
> service or a complete protocol-conformance test suite.

## 📚 Contents

- [HTTP GET vs. QUERY Demo](#http-get-vs-query-demo)
  - [📚 Contents](#-contents)
  - [🔎 Overview](#-overview)
  - [✨ Features](#-features)
  - [🧰 Technology stack](#-technology-stack)
  - [✅ Requirements](#-requirements)
  - [🚀 Getting started](#-getting-started)
  - [🖥️ Running the servers](#️-running-the-servers)
    - [Start the GET server](#start-the-get-server)
    - [Start the QUERY server](#start-the-query-server)
  - [🌐 HTTP API](#-http-api)
    - [`GET /contacts`](#get-contacts)
    - [`QUERY /contacts`](#query-contacts)
      - [Status codes and headers](#status-codes-and-headers)
  - [🧠 Query behavior](#-query-behavior)
  - [🧪 Demo script](#-demo-script)
  - [🗂️ Project structure](#️-project-structure)
  - [⚙️ Configuration](#️-configuration)
  - [🛠️ Development and validation](#️-development-and-validation)
    - [Type-check](#type-check)
    - [Available npm scripts](#available-npm-scripts)
    - [TypeScript notes](#typescript-notes)
  - [🩹 Troubleshooting](#-troubleshooting)
    - [`EADDRINUSE` or a port is already in use](#eaddrinuse-or-a-port-is-already-in-use)
    - [The QUERY server rejects the request or the method is not recognized](#the-query-server-rejects-the-request-or-the-method-is-not-recognized)
    - [The demo script cannot write its log files](#the-demo-script-cannot-write-its-log-files)
    - [`npm run demo` runs `demo-server.sh` and `npm run server` runs `server.sh`.](#npm-run-demo-runs-demo-serversh-and-npm-run-server-runs-serversh)
    - [`npm test` fails](#npm-test-fails)
  - [🔐 Limitations and security notes](#-limitations-and-security-notes)
  - [🤝 Contributing](#-contributing)
  - [📄 License](#-license)

## 🔎 Overview

The project exposes the same simple contact-search operation through two
different HTTP methods:

| Server | Method | URL | Query input |
| --- | --- | --- | --- |
| GET demo | `GET` | `http://localhost:3000/contacts` | URL query parameters |
| QUERY demo | `QUERY` | `http://localhost:3001/contacts` | JSON request body |

Both servers use the shared `runQuery` function in [`contacts.ts`](./contacts.ts),
so the examples compare request transport and protocol handling rather than
different search implementations.

The QUERY server demonstrates a method whose body can carry structured query
criteria without putting those criteria in the URL. The source comments
associate the example with RFC 10008. Treat this repository as a demonstration
of the behaviors implemented here; it does not claim complete validation of
every requirement in that specification.

## ✨ Features

- Side-by-side GET and QUERY examples backed by one shared data/query function.
- Case-insensitive substring matching against a contact's surname or email.
- Optional result limiting and field selection.
- JSON responses with a consistent `{ "results": [...] }` envelope.
- QUERY request content-type checks and JSON/query-shape validation.
- QUERY capability discovery through `OPTIONS`, `Allow`, and `Accept-Query`.
- A shell-based demonstration covering successful requests and selected error
  responses.
- TypeScript strict-mode checking.

## 🧰 Technology stack

| Technology | Role |
| --- | --- |
| 🟩 [Node.js](https://nodejs.org/) | Runtime and built-in HTTP server (`node:http`) |
| 🟦 [TypeScript](https://www.typescriptlang.org/) | Typed application source |
| ⚡ [tsx](https://github.com/privatenumber/tsx) | Runs TypeScript source directly during development |
| 📦 npm | Dependency installation and package scripts |
| 🐚 Bash | Optional end-to-end demo orchestration |
| 🌐 `curl` | HTTP requests in examples and the shell demo |

The project has no application framework, database, frontend, build output,
environment-variable loader, or production deployment configuration.

## ✅ Requirements

- Node.js. The QUERY server's source comments state **Node.js 21.7.2 or newer**
  because the runtime HTTP parser must recognize the `QUERY` method. Prefer a
  currently supported Node.js release; Node.js 22 or newer is recommended.
- npm (normally installed with Node.js).
- For `demo-server.sh`: Bash and `curl`. Its cleanup also uses common Unix-like
  process/port tools when available (`pkill`, `kill`, `fuser`, or `lsof`).

Check the installed runtime:

```sh
node --version
npm --version
```

The demo shell script is intended for Linux, macOS, WSL, or Git Bash. The
individual servers can be run with npm on any platform supported by Node.js.

## 🚀 Getting started

Clone the repository and install the locked dependencies:

```sh
git clone https://github.com/CryptoKingXavier/http-proxy.git
cd http-proxy
npm ci
```

`npm ci` installs the versions recorded in `package-lock.json`. The runtime
dependencies are Node.js built-ins; TypeScript, `tsx`, and Node.js type
definitions are development dependencies.

## 🖥️ Running the servers

Run each server in its own terminal from the repository root.

### Start the GET server

```sh
npm run start:get
```

It listens on port `3000` and handles `GET /contacts`.

### Start the QUERY server

```sh
npm run start:query
```

It listens on port `3001` and handles `QUERY /contacts` plus the `OPTIONS`
discovery request.

Stop either server with `Ctrl+C`. The port numbers are constants in
[`get-server.ts`](./get-server.ts) and [`query-server.ts`](./query-server.ts);
there is currently no environment-based port configuration.

## 🌐 HTTP API

### `GET /contacts`

The GET endpoint reads `match`, `limit`, and `select` from the URL.

```sh
curl "http://localhost:3000/contacts?match=example.com&limit=2&select=surname,email"
```

The `select` parameter accepts a comma- or period-separated list of field names.
This request returns JSON similar to:

```json
{
  "results": [
    {
      "surname": "Lovelace",
      "email": "ada@example.com"
    },
    {
      "surname": "Hopper",
      "email": "grace@example.com"
    }
  ]
}
```

The sample data has four contacts. The GET endpoint only accepts `GET` for the
`/contacts` route. Other paths return `404 Not Found`; other methods return
`405 Method Not Allowed` with `Allow: GET`.

### `QUERY /contacts`

The QUERY endpoint receives the criteria as a JSON body:

```sh
curl -X QUERY "http://localhost:3001/contacts" \
  -H "Content-Type: application/json" \
  -d '{
    "match": "example.com",
    "limit": 2,
    "select": ["surname", "email"]
  }'
```

The expected shape is an object containing optional fields:

| Field | Type | Behavior |
| --- | --- | --- |
| `match` | string | Case-insensitive substring match in surname or email |
| `limit` | finite number | Keeps at most the first `limit` results after flooring it |
| `select` | array of strings | Selects matching fields (`surname`, `email`) |

The QUERY endpoint validates those known fields before calling the shared
query function. The response is JSON with the same `results` envelope as GET.

#### Status codes and headers

| Condition | Status | Response behavior |
| --- | ---: | --- |
| Unknown path | `404` | `Not Found` |
| Method other than QUERY or OPTIONS | `405` | Includes `Allow: QUERY, OPTIONS` and `Accept-Query: application/json` |
| QUERY request has no `Content-Type` | `400` | The content type is required |
| QUERY request has an unsupported content type | `415` | Includes `Accept-Query: application/json` |
| Invalid JSON or invalid known-field types | `422` | The request content cannot be processed |
| Valid QUERY request | `200` | JSON response and `Accept-Query: application/json` |
| OPTIONS request to the contacts route | `204` | Includes `Allow: QUERY, OPTIONS` and `Accept-Query: application/json` |

For example, discover the QUERY capability with:

```sh
curl -i -X OPTIONS "http://localhost:3001/contacts"
```

The advertised query media type is `application/json`.

## 🧠 Query behavior

The shared function in [`contacts.ts`](./contacts.ts) applies these rules:

1. If `match` is present, it is lowercased and matched as a substring against
   each contact's `surname` and `email`, also case-insensitively.
2. If `limit` is a finite number, it is floored and clamped to a minimum of
   zero before slicing the result list. A negative limit therefore produces an
   empty list.
3. If `select` is omitted, each result contains both fields. Otherwise, only
   recognized field names (`surname` and `email`) are copied into each result.
4. An empty `match` string matches every contact. Unrecognized `select` names
   are ignored; if none of the requested fields are recognized, each result is
   an empty object.

The `Contact` and `ContactQuery` types describe the in-memory records and query
input. This demo does not perform ranking, sorting, pagination cursors, or
database lookups.

## 🧪 Demo script

[`demo-server.sh`](./demo-server.sh) starts both TypeScript servers, waits for
them to accept connections, runs GET and QUERY examples, checks selected
validation failures, inspects the OPTIONS headers, and then attempts to stop the
servers.

Run it from Bash at the repository root:

```sh
mkdir -p logs
bash demo-server.sh
```

The `logs` directory is required because the script redirects server output to
`logs/get-server.log` and `logs/query-server.log`. It is not created by the
script itself. Keep both ports (`3000` and `3001`) free before starting.

> [!NOTE]
> The package script `npm run demo` currently points to `bash demo-server.sh`, and
> `npm run server` points to `bash server.sh`.

[`server.sh`](./server.sh) is another shell script in the repository, but its
current readiness loop can wait indefinitely while a server is responding.
Prefer the npm commands for running servers or `demo-server.sh` for the
demonstration.

## 🗂️ Project structure

```text
.
├── contacts.ts       # Contact/query types, in-memory sample records, shared search
├── get-server.ts     # GET /contacts server on port 3000
├── query-server.ts   # QUERY /contacts and OPTIONS server on port 3001
├── demo-server.sh    # Starts both servers and runs curl demonstrations
├── server.sh         # Alternate/legacy server shell script
├── CMDS              # Stored setup/download shell commands
├── package.json      # npm scripts and development dependencies
├── package-lock.json # Locked npm dependency graph
├── tsconfig.json     # TypeScript compiler settings
├── .gitignore        # Ignore rules for Node.js and Windows artifacts
└── LICENSE.txt       # MIT license text
```

`node_modules/` is generated locally by npm and is not source code.

## ⚙️ Configuration

There is no `.env` file or runtime configuration layer. Current settings are
defined in source:

| Setting | Location | Current value |
| --- | --- | --- |
| GET server port | `get-server.ts` | `3000` |
| QUERY server port | `query-server.ts` | `3001` |
| Query/response media type | Both server files | `application/json` |
| Sample contact records | `contacts.ts` | Four in-memory records |

Change the corresponding source constants/data to customize this demonstration.
The application does not persist updates: restarting a server restores the
same hard-coded sample contacts.

## 🛠️ Development and validation

### Type-check

```sh
npm run typecheck
```

This runs `tsc --noEmit` with the strict options in [`tsconfig.json`](./tsconfig.json).
It checks the TypeScript source without generating output files.

### Available npm scripts

| Command | Purpose |
| --- | --- |
| `npm run start:get` | Start the GET server with `tsx` |
| `npm run start:query` | Start the QUERY server with `tsx` |
| `npm run typecheck` | Type-check without emitting files |
| `npm run demo` | Currently points to `demo-server.sh` |
| `npm run server` | Currently points to `server.sh` |
| `npm test` | Placeholder that exits with “no test specified”; no automated test suite is configured |

The shell demonstration exercises a small set of HTTP cases, but it is not a
unit-test framework or a complete regression/conformance suite.

### TypeScript notes

- The package uses ECMAScript modules (`"type": "module"`).
- Imports use explicit `.ts` extensions, enabled by
  `allowImportingTsExtensions`.
- `module` is set to `nodenext`, and strict type checking is enabled.
- The source is run directly by `tsx`; a separate build/transpile command is
  not defined.

## 🩹 Troubleshooting

### `EADDRINUSE` or a port is already in use

Another process is using port `3000` or `3001`. Stop that process or change the
port constant in the relevant server file, then restart the server.

### The QUERY server rejects the request or the method is not recognized

- Check `node --version`; use a current Node.js release (Node.js 22+ is
  recommended).
- Ensure the request method is exactly `QUERY`.
- Set `Content-Type: application/json`.
- Send a JSON object; `match` must be a string, `limit` a finite number, and
  `select` an array of strings when provided.

### The demo script cannot write its log files

Create the expected directory before running the script:

```sh
mkdir -p logs
```

Also ensure you are using Bash and running the command from the project root.

### `npm run demo` runs `demo-server.sh` and `npm run server` runs `server.sh`.

Run `bash demo-server.sh` or `bash server.sh` instead (after creating `logs/`). The npm script and
the checked-in filename are currently inconsistent.

### `npm test` fails

This is the current package placeholder, not a test failure in application
code. There is no automated test suite configured.

## 🔐 Limitations and security notes

- This is a local learning/demo application, not a general-purpose proxy or
  production-ready API.
- It binds using Node's default server host behavior and has no authentication,
  authorization, TLS configuration, CORS policy, rate limiting, or persistence.
- The QUERY implementation buffers the full request body in memory and does
  not impose a request-body size limit. Do not expose it to untrusted clients.
- Error responses and validation are intentionally minimal. There is no
  centralized error middleware, structured logging, or operational monitoring.
- The QUERY server checks the known query properties' types, but this should not
  be treated as a complete schema or protocol validation layer.
- The shell cleanup attempts to terminate demo processes and may use
  port-oriented fallback tools. Run the demonstration only in a local
  development environment where those ports are dedicated to this demo.
- The repository is named `http-proxy`, but no proxying, forwarding, or
  destination selection is implemented.

## 🤝 Contributing

Contributions should keep the GET and QUERY paths behaviorally aligned through
the shared query function and keep documentation examples executable against
the actual scripts and routes.

Before opening a change:

1. Install dependencies with `npm ci`.
2. Run `npm run typecheck`.
3. If HTTP behavior changes, exercise both endpoints and the relevant error
   cases with `curl` or the demo script.
4. Update this README when routes, fields, status codes, dependencies, or run
   commands change.

## 📄 License

The repository includes an MIT license in [`LICENSE.txt`](./LICENSE.txt).
