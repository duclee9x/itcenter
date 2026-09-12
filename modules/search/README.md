# Search module

Search owns only the derived `operations.search_documents` projection and
tenant-scoped query/rebuild behavior. Canonical records remain owned by their
source domains. The API reauthorizes every candidate through that domain's
read permission, while the worker refreshes documents from canonical rows after
committed outbox events. Reindexing is bounded and resumable.

Search results are navigation hints. Mutations must return to the owning domain
command, which rechecks authorization, state and concurrency against canonical
data.
