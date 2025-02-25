# Live Queries

A _query_ is a representation of the client's data requirements; It identifies a set of nodes on the server that the client wants to retrieve.

A _live query_ is a query where, in addition to the current value of the matching nodes, the client wants to be notified of any updates to those nodes until it ends the live query.

Live queries are often the most straightforward abstraction for applications with real-time data requirements. Alternate approaches like GraphQL subscriptions require the client to update query results based on received events; doing this correctly requires re-implementing business logic that already exists on the server, and to handle ordering inconsistencies between query results and subscription payloads.

Live queries have a reputation of being hard and inefficient to implement on the server, especially in a microservice environment where different parts of a query are served by different services. The Graffy data model and middleware architecture make building performant live query servers as easy as building a REST API.

## Cache

The cache performs the following:

- When a *get* occurs, try to fulfill the known subquery from the cache and delegate unknown subquery to upstream handlers. Update the cache with returned results. (Todo: eviction)

- When a *put* occurs, forward to upstream handlers and if successful, update the cache. (Todo: optimism)

- When a *sub* occurs, add the query and stream to the ongoing subscriptions list and create or update an upstream subscription that combines all current subscriptions. Remove when the sub is dropped. (Query aggregation)

- Whenever new data is put into the cache, notify listeners whose queries intersect. For each listener, fetch additional data if the query is not fully satisfied from the cache.
