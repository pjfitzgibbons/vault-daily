  # Vault Daily

Vault Daily is a Docker-first daily notes app with:
- A Vue 3 + Vite UI for task, standup, and notes workflows
- A Node.js backend for markdown file I/O and Jira submit/proxy operations
- Structured logging for server and client-side interactions

For architecture and component-level details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Requirements

- Docker + Docker Compose (recommended)
- Node.js 18+ (optional for local non-Docker workflows)

## Quick Start (Docker)

```bash
# Build and start runtime service
./bin/start

# Open app
# http://localhost:8008
```

Useful Docker scripts:

```bash
./bin/rebuild   # rebuild images, run tests, restart service
./bin/restart   # restart service
./bin/stop      # stop service
```

## Local Development (Optional)

```bash
npm install
npm run dev
```

This starts Vite and the backend for local development.

## Testing

```bash
npm test
npm run test:e2e
```

Docker test profile:

```bash
docker compose --profile test run --rm vault-test
```

## Configuration

Template config: [config.template.json](config.template.json)

Create your local runtime config (gitignored):

```bash
cp config.template.json config.json
```

Local runtime config file: `config.json` (not tracked)

Key Jira fields:
- `jira.baseUrl`
- `jira.email`
- `jira.token`
- `jira.fields.yesterday`
- `jira.fields.today`
- `jira.fields.blockers`

Environment examples are in [.env.example](.env.example).

## Logging

- Server logs are written to [log/server.log](log/server.log)
- In debug mode, client interaction logs are forwarded to the server (`/api/client-log`)
- `docker-compose.yml` maps `./log` to `/app/log` at runtime

## API Endpoints

- `GET /api/daily/:date`
- `PUT /api/daily/:date`
- `GET /api/dates`
- `GET /api/projects`
- `POST /api/jira/standup`
- `POST /api/client-log`

## Project Docs

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [context.md](context.md)

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
