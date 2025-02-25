import isEmpty from './isEmpty';

import { unwrap, makeNode } from './path';
import { isRange, splitRange, encRange } from './range';
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
      // console.log('split', node, key, keys, known, unknown);
      keys.forEach(k => step(node[k], subQuery, path.concat(k)));
      if (unknown) step(undefined, subQuery, path.concat(unknown));
      if (known.length) visit({ [PAGE_KEY]: known }, subQuery, path);
    }
  }

  step(root, rootQuery, []);
}

function set(object, path, value) {
  const key = path[path.length - 1];
  const node = makeNode(object, path.slice(0, -1));
  if (typeof value !== 'object' || !value) {
    if (typeof node[key] !== 'object' || !node[key]) node[key] = value;
    return;
  }

  if (typeof node[key] !== 'object' || !node[key]) node[key] = {};
  merge(node[key], value);
}

/*
  getUnknown (new branches)
  Given a cached tree and a query, return a new query representing parts of the
  input query that are not present in the tree.
*/

export function getUnknown(root, rootQuery) {
  const nextQuery = {};

  walk(root, rootQuery, (node, query, path) => {
    if (typeof node === 'undefined') set(nextQuery, path, query);
  });

  return isEmpty(nextQuery) ? undefined : nextQuery;
}

/*
  getKnown (returns only parts of the graph that exist in query)
*/

export function getKnown(root, rootQuery) {
  const result = {};

  walk(root, rootQuery, (node, query, path) => {
    if (typeof node === 'undefined') return;

    if (typeof node !== 'object' || !node || node[LINK_KEY] || node[PAGE_KEY]) {
      set(result, path, node);
      return;
    }

    // Node is an object, but query is a leaf.
    set(result, path, null);
  });

  return isEmpty(result) ? undefined : result;
}

export function getMaxKnown(root, rootQuery) {
  const result = {};

  walk(root, rootQuery, (node, query, path) => {
    // console.log('step', path, node, query);
    if (typeof node === 'undefined') {
      return;
    }

    if (typeof node !== 'object' || !node || node[LINK_KEY] || node[PAGE_KEY]) {
      set(result, path, node);
      return;
    }

    // Node is an object, but query is a leaf.
    set(result, path, null);
  });

  return isEmpty(result) ? undefined : result;
}

/* hasKnown (check if query matches any part of graph) */

export function hasKnown(root, rootQuery) {
  // TODO: Make this more efficient.
  return !!getKnown(root, rootQuery);
}

/*
  linkKnown: Copies parts of the query that cross links, repeating them at their
  canonical positions.

  The returned value is used to compute intersections with change objects.
*/

export function linkKnown(root, rootQuery) {
  const result = {};

  walk(root, rootQuery, (node, query, path) => {
    // console.log('step', path, node, query);
    if (node && node[PAGE_KEY]) {
      const [after, before] = node[PAGE_KEY];
      set(result, path, { [encRange({ after, before })]: query });
      return;
    }

    set(result, path, query);
  });

  return isEmpty(result) ? undefined : result;
}
