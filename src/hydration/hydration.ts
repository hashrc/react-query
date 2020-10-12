import type { QueryClient } from '../core/queryClient'
import { Query, QueryState } from '../core/query'
import type { QueryKey, QueryOptions } from '../core/types'

// TYPES

export interface DehydrateOptions {
  shouldDehydrate?: ShouldDehydrateFunction
}

export interface HydrateOptions {
  defaultOptions?: QueryOptions
}

interface DehydratedQueryConfig {
  cacheTime: number
}

interface DehydratedQuery {
  queryKey: QueryKey
  queryHash: string
  state: QueryState
  config: DehydratedQueryConfig
}

export interface DehydratedState {
  queries: Array<DehydratedQuery>
}

export type ShouldDehydrateFunction = (query: Query) => boolean

// FUNCTIONS

function serializePositiveNumber(value: number): number {
  return value === Infinity ? -1 : value
}

function deserializePositiveNumber(value: number): number {
  return value === -1 ? Infinity : value
}

// Most config is not dehydrated but instead meant to configure again when
// consuming the de/rehydrated data, typically with useQuery on the client.
// Sometimes it might make sense to prefetch data on the server and include
// in the html-payload, but not consume it on the initial render.
function dehydrateQuery(query: Query): DehydratedQuery {
  return {
    config: {
      cacheTime: serializePositiveNumber(query.cacheTime),
    },
    state: query.state,
    queryKey: query.queryKey,
    queryHash: query.queryHash,
  }
}

function defaultShouldDehydrate(query: Query) {
  return query.state.status === 'success'
}

export function dehydrate(
  client: QueryClient,
  options?: DehydrateOptions
): DehydratedState {
  options = options || {}

  const shouldDehydrate = options.shouldDehydrate || defaultShouldDehydrate
  const queries: DehydratedQuery[] = []

  client
    .getQueryCache()
    .getAll()
    .forEach(query => {
      if (shouldDehydrate(query)) {
        queries.push(dehydrateQuery(query))
      }
    })

  return { queries }
}

export function hydrate(
  client: QueryClient,
  dehydratedState: unknown,
  options?: HydrateOptions
): void {
  if (typeof dehydratedState !== 'object' || dehydratedState === null) {
    return
  }

  const cache = client.getQueryCache()
  const defaultOptions = options?.defaultOptions || {}
  const queries = (dehydratedState as DehydratedState).queries || []

  queries.forEach(dehydratedQuery => {
    const query = cache.get(dehydratedQuery.queryHash)

    // Do not hydrate if an existing query exists with newer data
    if (query) {
      if (query.state.updatedAt < dehydratedQuery.state.updatedAt) {
        query.setState(dehydratedQuery.state)
      }
      return
    }

    // Restore query
    client.restoreQuery(
      {
        ...defaultOptions,
        queryKey: dehydratedQuery.queryKey,
        queryHash: dehydratedQuery.queryHash,
        cacheTime: deserializePositiveNumber(dehydratedQuery.config.cacheTime),
      },
      dehydratedQuery.state
    )
  })
}
