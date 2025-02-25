## Example

Let's imagine we're building an app that allows users to send pokes to each other. Its data may look like:

```js
{ users: {
    1: {
      name: 'Alice',
      pokes: { 1: '/pokes/1' } },
    2: {
      name: 'Bob',
      pokes: { 1: '/pokes/1' } } },
  pokes: {
    1: {
      time: '2018-01-01T00:00:00',
      participants: {
        poker: '/users/1',
        pokee: '/users/2' },
      message: 'Hi!' } } }
```

JSONPaths like `/pokes/1` represent links.

### Limitations

- Graffy cannot model lists (arrays). While maps with integer keys are possible, list-like insert / delete semantics are not supported.
- Graffy cannot store `null` as a leaf value distinct from a non-existant key.

## Client-side usage

Graffy supports three operations:

- get: Query
- sub: Live query
- put: Mutation

Graffy is also very modular, with most functionality being implemented in Providers.

```js
import Graffy, { Schema, ClientCache, Connector } from 'graffy';

const graffy = new Graffy();
graffy.use(new Schema(schema));
graffy.use(new ClientCache({ age: 5 * 60 }));
graffy.use(new Connector('https://example.com/api/'));

// One-time query
const val = await graffy.get(path, shape);

// Live query
for await (const val of graffy.sub(path, shape)) {
  // Handle live query value
  break; // unsubscribe
}

// Mutation
await graffy.put(path, change);
```

`Schema`, `Cache` and `Connector` are Graffy Providers. Custom Providers can also be written.

## Simple queries

Leaf nodes can be fetched directly with their JSONPaths:

```js
graffy.get('users/1/name');
// Returns a promise resolving to:
('Alice');
```

Using the default connector, this results an HTTP GET request:

```http
GET /users/1/name

200 Ok

{ "users": { "1": { "name": "Alice" } } }
```

However, querying objects and arrays in a similar way does not work as expected:

```js
graffy.get('pokes/1');
{
}
```

This is because Graffy does not include child fields by default.

The client must specify the fields it is interested in, using a GraphQL-like object we call the _shape_, a Falcor-like array we call the _pathset_, or a combination of both. These examples use shapes:

```js
graffy.get('pokes/1', { time: true, message: true })
{ time: '2018-01-01T00:00:00', message: 'Hi!' }
```

Any truthy value can be used in place of `true` to indicate fields to request. The HTTP request is:

```http
GET /pokes/1/(time,message)
```

Links can be traversed transparently:

```js
graffy.get(['pokes', 1, 'participants', 'poker', 'name']);
('Alice');
```

The HTTP response shows the links traversed in resolving the query. This information helps the client library cache the request efficiently.

```http
GET /pokes/1/participants/poker/name

200 Ok

{ "pokes": { "1": { "participants": { "poker": "users/1" } } },
  "users": { "1": { "name": "Alice" } } } }
```

Links themselves are considered strings, which allow them to be modified with put:

```js
graffy.get(['pokes', 1, 'participants', 'poker']);
('users/1');
```

What if we need the names of all participants? We can use the `*` wildcard:

```js
graffy.get(['pokes', 1, 'participants'], { '*': { name: true } })
{ "poker": { "name": "Alice" },
  "pokee": { "name": "Bob" } }
```

```http
GET /pokes/1/participants/*/name
```

## Range queries

`*` should only be used for nodes that we know to have a limited number of keys. For nodes with many keys, a better approach is to use keysets that allow retrieving only some of the keys.

Let's say we want the first 10 users, ordered by user ID:

```js
graffy.get('users', Map { { $first: 10 } = { name: true } })
Map {
  1 = { name: 'Alice' },
  2 = { name: 'Bob' },
  ...
  hasFirst: true,
  hasLast: false,
}
```

```http
GET /users/10**/name
```

`{ $first: 10 }` is a _keyset_, and its equivalent string representation is `10**`. The shape argument here is a JavaScript map which allows objects to be used as keys. The Response is also a JS map object which will iterate in the order of the keys.

**Note:** Keysets support four parameters (`$first`, `$after`, `$last` and `$before`) that work similarly to GraphQL Connections for cursor-based pagination. `after` and `before` are interpreted as keys, while `first` and `last` are positive integers.

The response object may have an additional object properties (not map members) that are equivalent to GraphQL's `PageInfo`.

See the [Reference](#reference) section below for more information.

### Indexes

Paginating over things by ID alone isn't very useful. More realistically, we might want the latest 10 pokes by `time`:

```js
graffy.get('pokesByTime', [ { $last: 10 }, 'message' ])
Map {
  ...
  1999 = { message: 'Poke!' },
  2000 = { message: 'Hey.' },
  hasFirst: false,
  hasLast: true
}
```

The HTTP query is:

```http
GET /pokesByTime/**10/message
```

`pokesByTime` is an _index_ of the `pokes` collection. Note that instead of a shape, we are providing a pathset here.

**Note:** As seen in these examples, Graffy offers multiple equivalent ways to specify paths, shapes and keysets. In their normalized forms, paths are arrays, shapes are JS maps and keysets are objects or arrays. In transit (request URLs) they are all strings. For convenience, shapes can also be specified using plain JS objects or arrays similar to Falcor's _pathsets_ (as seen here).

### Filters

Say we want the latest 10 pokes received by user 2:

```js
graffy.get(['pokesByTime', { pokee: 'users/2' }], [{ $last: 10 }, 'message'])
Map {
  ...
  1999 = { message: 'Poke!' },
  2000 = { message: 'Hey.' },
  hasFirst: false,
  hasLast: true
}
```

`{ pokee: 'users/2' }` is a _filter_. Note that unlike GraphQL, filters and ranges (for pagination) cannot be combined at the same level in the tree.

## Live queries

`graffy.sub()` works with the same arguments as `graffy.get()` but returns a stream of responses. The responses are _immutable_, i.e. when the data changes it emits a new object rather than modifying objects that were emitted previously.

The API is based on ES2018 Async Iterators:

```js
const stream = graffy.sub('/users/1', { name });

for await (const value of stream) {
  /* do something */
}
```

To unsubscribe, simply break out of the `for await` loop.

Using the default resolver, live queries use Server-Sent-Events over HTTP.

```http
GET /users/1?include=name
Accept: text/event-stream
```

## Server-side usage

Node.js server-side is quite similar to the client.

```js
import Graffy, { Schema, SqlClient, Server } from 'graffy';
import Express from 'express';

const app = new Express();

const graffy = new Graffy();
graffy.use(new Schema(schema));
graffy.use(new SqlClient(options));

const { graffyLink, expressLink } = new Server();
graffy.use(graffyLink);
app.use(expressLink);
```

## Type system

The "Schema" Provider adds a type system and provides functionality such as introspection, validation and serialization of complex data (e.g. dates) to Graffy. Its use is not mandatory but recommended.

### Schema

The schema object describes the shape of the data store and is represented similarly to shapes:

```js
const Poke = {
  startTime: Schema.date.required,
  message: Schema.string,
  participants: {
    poker: Schema.link.required,
    pokee: Schema.link.required,
  },
};
```

Here `Poke` and `Poke.participants` are _structs_, because their keys are known ahead of time. The other kind of node in schemas is the _collection_, whose keys are not known, although their types are.

An example is the PokeCollection:

```js
const PokeCollection = Map {
  [Schema.string] = Poke
}
// or alternately
const PokeCollection = [Schema.string, Poke]
```

The root schema can be defined as:

```js
{
  users: UserCollection,
  pokes: PokeCollection
}
```

## <a name="reference"></a>Reference

### Changesets

The values returned by the read handler (except the first value) and expected by the write handler are _changeset_ objects. They are represented by JSON Merge Patch objects.

### Range

Sets of keys may be requested using several patterns:

```
String  Object                                Meaning
*       { $all: true }                        All keys
k*      { $after: k }                         All keys after k
*k      { $before: k }                        All keys before k
j*k     { $after: j, $before: k }             All keys between j and k
n**     { $first: n }                         The first n keys
**n     { $last: n }                          The last n keys
k*n**   { $first: n, $after: k }              First n after k
**n*k   { $last: n, $before: k }              Last n before k
m*k*n   { $first: n, $last: m, $around: k }   k, m before it and n after it
j*n**k  { $first: n, $after: j, $before: k }  First n between j and k
j**n*k  { $last: n, $after: j, $before: k }   Last n between j and k
(j,k)   [ j, k, ... ]                         Several keys
```

### Alternate representations

Keysets may be represented by strings or objects as shown above.

Paths can be specified using strings (`pokes/1`) and arrays (`['pokes', 1]`). In a string, path segments (keys) must be escaped and keysets must use their string representations. In an array, keys are _not_ escaped, and keysets must use their object representation.

Pathsets can also be specified with strings (`pokes/(1,2)/time`) or arrays (`['pokes', [1, 2], 'time']`). Shapes can be specified using JS objects or JS maps. It is also possible to nest shapes and pathsets inside each other.

Nested maps are the most general representation, and it can represent any valid Graffy query. In contexts that don't support maps (JSON, URLs) a combination of maps and pathsets can be used:

```js
// These are all equivalent
{ users: Map { [1, 2] = { name: true } } } // Objects and maps
['users', [1, 2], 'name'] // Pathset
{ users: [[1, 2], 'name']} // Pathset in object
{ users: [[1, 2], { name: true }]} // Object > Pathset > Object
'users/(1,2)/name' // String pathset
{ 'users/(1,2)': { name: true } }
{ users: { '(1,2)': { name: true } } } // Object with string keyset
```

The property names of JS objects are _escaped_ keys, stringified pathsets or stringified keysets. In maps and arrays, keys are _not_ escaped, and keysets and pathsets use the object or array forms.

## Provider API

```js
class CustomProvider {
  constructor(options) {}

  init(graffy) {
    this.graffy = graffy;
    graffy.onGet(this.handleGet);
    graffy.onPut(this.handlePut);
  }

  async handleGet({ shape, token }, next) {
    // A non-null token indicates it's a subscription.
    // The token's onClose callback notifies that the
    // subscription can be closed.
    token.onClose(() => {});

    // If this provider is unable to definitively serve or
    // reject this request (e.g. cache), yield to the next
    // provider.
    await next({ shape, token });

    // Return a promise that resolves to the value.
  }

  handlePut(changes, next) {}

  onSomeEvent() {
    graffy.pub(tree); // publish a change set
    graffy.close(token); // initiate subscription close
  }
}
```
