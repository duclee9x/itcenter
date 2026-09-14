# Release candidate records

The protected GitHub Actions publish workflow creates one immutable JSON
record per RC here after the shared OCI image has been pushed. The record
identifies source commit, image digest, migration manifest revision, lockfile
hash, build workflow, and SBOM provenance. It contains no secrets.

Staging and production execution state is recorded separately on the
deployment host under `/var/lib/itcenter/release-state/`; a successful
staging attestation is bound to the RC id, image digest, commit, and schema
revision. Do not rewrite a finalized RC record to represent mutable host state.
