# Local operations and recovery

GuideKit remains a local application with workspace roles. The container recipe packages
that application; it does not turn a personal ChatGPT subscription into a public
shared inference service. The server's loopback listeners and Host restrictions
remain in place. Commercial hosting and customer inference identity are separate
work.

## Online backup

```sh
npm run backup -- --data-dir .data --dest .backups/guidekit-2026-10-29
```

The destination must be a new directory outside the source data directory.
The command uses Node's asynchronous `node:sqlite.backup()` API, so committed
WAL data is included consistently while GuideKit is serving requests. It does
not copy a live SQLite file with filesystem copy commands. Other writers can
cause SQLite's backup to restart; heavy write activity can make the operation
take longer. See the [Node 24 SQLite backup documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html#sqlitebackupsourceDb-path-options).

The archive directory contains exactly:

- `guidekit.sqlite`: a checked, standalone SQLite snapshot without WAL sidecars.
- `session.secret`: the signing secret needed to preserve dashboard sessions.
- `manifest.json`: archive format version, schema markers, page count, sizes and
  SHA-256 checksums of both files.
- `.gitignore`: ignores every archive file, including itself.

Directories are mode `0700` and files `0600` on Unix filesystems. Treat the archive
as a credential-bearing private copy: it contains company data, account hashes,
sessions and the session signing secret. The archive is not encrypted, and its
checksums detect corruption rather than authenticate an untrusted sender.
Use an encrypted storage destination with a separate access policy for off-device
copies. Never attach an archive to a public issue or commit it.

Only those two source files are included. Environment files, Codex credentials,
runtime sandboxes, logs, personal media and arbitrary neighboring files are
excluded. Graph data and Codex login state are not backed up by this command.
Coordinate session-secret rotation outside the backup window; the command checks
that the copied secret stayed unchanged during the snapshot and fails if it did
not. The manifest is written last and a failed backup removes its incomplete new
archive directory. Neither an existing archive nor source files are overwritten.

## Restore and verify

Prefer restoring into a **new** directory first. Stop the GuideKit service and any
other process with the target database open. Use the actual configured service
port if it differs from 4410.

```sh
npm run restore -- --source .backups/guidekit-2026-10-29 \
  --data-dir .data-recovered --offline --port 4410
```

`--offline` is an explicit operator acknowledgement, not a way to bypass checks.
Restore rejects a live process recorded in `.service.lock`, a listening loopback
service port, and open target database handles reported by `lsof` or `fuser`.
Existing-data restore fails closed if neither handle inspection tool is available.
An invalid service lock requires manual inspection after stopping the service;
`--force` never overrides an active process or a failed offline check.

Restore validates the archive format version, exact file allowlist, absence of
symlinks, both checksums, SQLite integrity/foreign keys and schema-marker agreement
before installing anything. It stages and checks the files in a private sibling
directory. It creates `${dataDir}.restore.lock` while restoring; the service must
refuse startup while this lock exists. The service owns `.service.lock` with its
process ID and removes it during a clean shutdown. Schema versions are preserved;
the application must apply supported migrations or reject a future database
version on startup. Restore does not rewrite a database into an older schema.

To explicitly replace an existing stopped data directory:

```sh
npm run restore -- --source .backups/guidekit-2026-10-29 \
  --data-dir .data --offline --force --port 4410 \
  --safety-backup .backups/before-recovery
```

`--force` first creates and verifies a new safety archive of the existing database
and secret. It then retains the entire original directory under a unique
`.before-restore-...` sibling name, protected with an ignore marker and private
directory permissions. An existing `.gitignore` is retained under a unique
`.gitignore.before-restore-...` name before the ignore marker is installed. The
final output reports both recovery locations. No
original directory is deleted automatically. If the final installation rename
fails, restore attempts to put the original directory back. Keep both recovery
copies until the restored application has passed your checks.

Start the service with `GUIDEKIT_DATA_DIR=.data-recovered` (or the intended restored
directory), then verify login, agents, documents, published versions and saved
outcomes. Recheck TigerGraph connectivity and re-sync an immutable version if
needed. A local restore does not roll back the external graph database. Test the
real inference provider separately; a restored session is not proof of entitlement
or a successful model request.

If a process is forcibly killed during restore, inspect the staging/original
directories and the sibling restore lock before removing anything. Do not run
two servers against a directory being restored. Choose backup frequency and
retention according to acceptable data loss, record the resulting recovery time,
and repeat this restore drill after schema changes. No scheduler or retention
deletion is installed automatically.

## Optional container packaging

```sh
docker compose -f compose.example.yaml config --quiet
docker compose -f compose.example.yaml build
docker compose -f compose.example.yaml run --rm guidekit \
  codex -c 'cli_auth_credentials_store="file"' login --device-auth
docker compose -f compose.example.yaml up -d
```

The official device-code flow signs in **inside** the container. Device-code login
must be enabled for the account/workspace. No credential is copied into an image,
build argument or repository; Codex owns its authentication files in a separate
private named volume. See [official OpenAI authentication guidance](https://learn.chatgpt.com/docs/auth).
Do not mount your entire home directory or manually extract desktop credentials.

The image uses Node 24, a non-root runtime user, the locked application dependency
set, and Codex CLI `0.151.0`, the version previously verified by this project.
The CLI version is an explicit build argument so a compatibility-tested upgrade
can be reviewed. This is not a claim that it is the newest Codex release. The image
retains `tsx` because the current server runs TypeScript directly; only dashboard
and SDK assets are bundled by the existing build.

The compose example deliberately uses **host networking**, with no published
`ports:` mappings. The application itself binds only to `127.0.0.1`; this keeps the
same local listener behavior. Linux supports host networking directly. Docker
Desktop requires its host-networking option, available in supported releases;
otherwise use the normal Node workflow rather than changing listeners to a public
interface. See [Docker's host networking documentation](https://docs.docker.com/engine/network/drivers/host/).

Data, Codex authentication and backups use three separate named volumes. Leave
them in place when recreating the container. `docker compose down --volumes`
would remove those volumes and is not a normal restart command. Optional graph
credentials must be supplied by the operator at runtime, never during the image
build. The provided compose file does not load a repository `.env` into the image.
Do not add public ingress, a tunnel or a shared reverse proxy to this personal
subscription runtime.

Inside the running container, the same backup script can write to its private
backup volume:

```sh
docker compose -f compose.example.yaml exec guidekit \
  node --import tsx scripts/backup.ts --data-dir /app/.data \
  --dest /app/.backups/guidekit-manual
```

For restore, stop the service container first and use a one-off container with the
same data/backup volumes. No automated container launch, authentication or live
subscription use is part of the build. The health check proves HTTP availability,
not a completed model request or universal host compatibility.

## Local account delivery

Recovery, email-verification and invitation links are delivered through the configured account adapter. The default is a private operator outbox at `.data/account-outbox/` (or the selected data directory), with `0700` directories and `0600` message files. No external email is sent. Open a requested message locally and use its expiring link; do not commit or share the outbox. Links keep their token in the browser fragment, and APIs store only token digests. Password changes/reset revoke prior sessions using an account epoch, including stale session writes. The backup archive intentionally excludes the outbox: after restoration, request new links rather than restoring old delivery messages. Configure a real delivery adapter and test delivery before offering hosted recovery.

## History retention and readiness

`GET /health` checks that the process is serving. `GET /ready` checks SQLite access, the selected runtime account/model and configured graph connectivity; it returns 503 for a failed dependency. It does not execute a paid model request or prove microphone readiness.

`npm run retention -- --days 30` previews eligible history. After taking a verified backup, append `--apply` to remove completed runs older than the cutoff whose session expired more than a day ago, their receipts, old audit events and expired account/session credentials. Pending approvals, running requests, accounts, company knowledge and immutable publications are retained. No automatic deletion job is enabled. Inspect and remove expired private account-outbox messages separately.

Workspace model usage is capped at 500 runs per UTC day and 100 active embed sessions by default, in addition to per-IP limits and two concurrent local inference slots. Adaptive continuation consumes the same request budget. Operators may explicitly set positive `GUIDEKIT_DAILY_RUN_LIMIT` and `GUIDEKIT_ACTIVE_SESSION_LIMIT` values. Replay of the identical completed request does not consume another inference. Changed page/journey data cannot reuse that request ID. Agent metrics aggregate status and latency; they exclude question/answer text and credentials.

For export, take a verified private backup: it preserves the workspace configuration, immutable versions, memberships and activity without exporting account delivery links or model credentials. A tenant erasure procedure must revoke its embed sessions, remove its local receipts/runs, knowledge indexes/snapshots/documents, memberships and audit data, and independently delete its scoped TigerGraph vertices using graph-admin credentials. There is no one-click erasure claim: this release intentionally does not expose a partial local delete that leaves external graph copies behind. Restores also recover previously deleted local history, so expire backups under the same retention policy.
