# Security and privacy

## Approval boundary

The gateway exposes only pairing, authenticated approval reads/decisions, operation receipts and push registration. Do not proxy the original desktop hook or management endpoints to the public Internet. Pairing codes are temporary and require explicit desktop generation; each device receives a separate credential. The Mac stores authentication hashes; the Watch stores its credential in Keychain.

A decision is "allow once" or "deny" for the current request revision. Expired, incomplete or changed requests are rejected. Another approval entry may settle a request first. A delivered receipt means the decision reached its integration channel; it does not by itself prove that a tool command finished successfully. After uncertain delivery, query the same operation instead of blindly resubmitting.

APNs payloads contain generic alert text and request identifiers, not command details or authentication credentials. Device push tokens are runtime data. Protect the Mac userData directory, APNs configuration and key files; do not commit them. HTTPS and device authentication are required even when the gateway is reachable through a private network.

## Public export

The published repository starts with a fresh source-only Git history. Original deployment logs, private configuration, signing profiles, device identifiers, local paths, personal server address and original Git author email/history are excluded. The notification screenshot uses an offline synthetic request. Public examples are placeholders, not usable credentials.

The .gitignore protects common local files, but is not a complete privacy guarantee. Before publishing your own changes, scan the staged files and all new Git history. Never attach a raw support bundle or full runtime database to a public issue.

## Reporting

Use GitHub's private vulnerability reporting when available. Do not post credentials, complete commands containing secrets, device tokens or personal server addresses in public issues.
