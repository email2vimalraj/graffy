import isEmpty from './isEmpty';

import { unwrap, makeNode } from './path';
import { isRange, splitRange } from './range';
import { LINK_KEY, PAGE_KEY } from './constants';
import merge from './merge';
import { includes } from './interval';

/*
  Given a tree, a query and a visitor callback, the walk function invokes
  the visitor for:
  - each node in the tree that matches the query, with node and path arguments.
  - each non-existent path in the tree that would have matched the query
  - each range key in the query, with the result bounds as the first argument.
*/

function walk(root, rootQuery, visit) {
  function step(node, query, path) {
    if (
      typeof node !== 'object' ||
      typeof query !== 'object' ||
      !node ||
      !query
    ) {
      visit(node, query, path);
      return;
    }

    const link = node[LINK_KEY];
    if (link) {
      visit(node, query, path);
      step(unwrap(root, link), query, link);
      return;
    }

    for (const key in query) {
      if (key === PAGE_KEY) continue;

      const subQuery = query[key];
      if (!isRange(key)) {
        const childNode =
          key in node
            ? node[key]
            : includes(node[PAGE_KEY] || [], key)
            ? null
            : undefined;
        step(childNode, subQuery, path.concat(key));
        continue;
      }

      const { keys, known, unknown } = splitRange(node, key);
      keys.forEach(k => step(node[k], subQuery, path.concat(k)));
      if (unknown) step(undefined, subQuery, path.concat(unknown));
      if (known) visit({ [PAGE_KEY]: known }, subQuery, path);
    }
  }

  step(root, rootQuery, []);
}

function set(object, path, value) {
  const key = path[path.length - 1];
  const node = makeNode(object, path.slice(0, -1));
  if (typeof value !== 'object' || !value) {
    node[key] = value;
    return;
  }

  if (typeof node[key] !== 'object' || !node[key]) node[key] = {};
  merge(node[key], value);
}

// Convert a raw response into a denormalized and easy-to-consume graph.
export function graft(root, rootQuery) {
  const graph = {};
  const links = [];

  // console.log('GRAFTED');

  walk(root, rootQuery, (node, query, path) => {
    // console.log('step', path, node, query);
    if (typeof node === 'undefined' || node === null) {
      // set(graph, path, null);
      return;
    }
    if (node[LINK_KEY]) {
      links.push([path, node[LINK_KEY]]);
    } else {
      set(graph, path, node);
    }
  });

  for (const [from, to] of links) set(graph, from, unwrap(graph, to));

  const result = {};
  walk(graph, rootQuery, (node, query, path) => {
    if (typeof node === 'undefined' || node === null) {
      // set(graph, path, null);
      return;
    }
    if (typeof node !== 'object') {
      set(result, path, node);
      return;
    }
    if (node[PAGE_KEY]) {
      const target = makeNode(result, path);
      Object.defineProperty(target, PAGE_KEY, { value: node[PAGE_KEY] });
    }
  });

  return isEmpty(result) ? undefined : result;
}
