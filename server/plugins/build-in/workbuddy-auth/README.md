# WorkBuddy authentication plugin

Uses the host plugin runtime, account store, model catalog and Cursor provider bridge directly.
There is no separate WorkBuddy gateway process.

## Usage

1. Open Plugins → WorkBuddy → Add account, then choose China or Global.
2. Complete the authorization page. Repeat Add account for each additional account.
3. Models synchronize after each successful login. Enable the desired models in account management
   and select them in Cursor.
4. Account management → Refresh queries credit balance; Credit packages shows the individual
   packages and expiry. China personal accounts also support manual daily check-in.
5. More → Import/Export selects the China or Global pool. Imports accept flat credentials and nested
   `auth`/`account` JSON from workbuddy2api-panel.

Accounts are identified by region, UID and enterprise ID. Nicknames never deduplicate users. Ready
accounts rotate for each invocation. Expired authorization and exhausted credits are excluded; a
resource failure before any output retries the next ready account once. After output starts, errors
end that response so text and tool calls from different accounts cannot be spliced together.
Credential operations for one account are serialized, with independent leases for other accounts.
The host holds one lock over account-list read/merge/write, including quota refreshes and removals.

## Upstream protocol reference

Reviewed on 2026-11-16:

- https://github.com/misakano7545/workbuddy2api-panel/tree/c4b53cd8024e38aa59fe1914691269776c757d2c
- Earlier reference:
  https://github.com/linguo2625469/workbuddy2api-panel/tree/73a7560efc7a88ebd9865db4c71ae7f6d85859f8
- Login endpoint headers and pending/fatal codes: `internal/loginsite/loginsite.go`.
- Chat, refresh and model discovery: `internal/upstream/{client,headers,clientpick}.go`.
- Current fractional credit summary and paid/free package shapes:
  `internal/upstream/billing_summary.go`.

China device login uses copilot.tencent.com with platform=workbuddy. Chat, model discovery and
billing use www.workbuddy.cn. Global device login uses the official www.codebuddy.ai with
platform=workbuddy-ai; imported www.workbuddy.ai accounts retain that account domain. Device
fingerprint tokens are used only when supplied in imported credentials.

Supported capabilities: login, chat/tool streaming, model discovery, account pooling, token renewal,
credits, package details, credential import/export and manual check-in.

The MIT attribution for the protocol adaptation is included in LICENSE.

## Validation

Run each built-in plugin's tests with its own deno.json. WorkBuddy tests use simulated HTTP/SSE
responses, including token rotation, account identity, fractional credits and in-stream errors.
`cargo test -p cursor-server --lib plugin:: -- --include-ignored` also runs real Deno worker pool
integration tests, using an isolated plugin, JSON store and SQLite database. These worker tests
require the app's pinned Deno runtime to be initialized; they do not use live account credentials. A
real account's browser authorization and a charged model request still require live verification.
