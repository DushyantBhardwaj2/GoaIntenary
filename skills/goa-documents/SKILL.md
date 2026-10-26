---
name: goa-documents
description: Design and verify secure shared booking and private ID document handling for the Goa trip companion. Use for uploads, S3 access, file processing, PDF export, or document retention.
---

# Trip documents

Read sections 4.7, 13, and 16 of [plan.md](../../plan.md). Files are either shared with accepted members of one trip or private to their owner. Organiser and content-admin roles never inherit another person's private IDs. Aadhaar uploads are optional; do not collect a full Aadhaar number as a normal profile field. Use synthetic files in development and testing.

The core API authorizes an upload intent, records pending metadata, and issues a short-lived scoped grant to private S3. The Python job validates the actual uploaded file and marks it Ready or Rejected. A download request checks current membership/ownership and status before granting access. Direct S3 URLs cannot be revoked immediately after issuance, so use very short expiry or an authenticated delivery path when immediate revocation matters.

Set size/type limits, encryption, safe object keys, deletion and backup retention behavior, and logging that omits document content. The group itinerary export excludes private identity files and private notes by default. Verify outsider access, member removal, cross-member private access, expired grants, rejected files, and export privacy. Record the exact accepted file formats and size limits as product decisions before launch.
