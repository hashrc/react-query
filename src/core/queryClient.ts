import {
  CancelOptions,
  QueryFilters,
  Updater,
  isVisibleAndOnline,
  noop,
  parseFilterArgs,
  parseQueryArgs,
  partialDeepEqual,
  uniq,
} from './utils'
import type {
  DefaultOptions,
  FetchQueryOptions,
  InvalidateOptions,
  InvalidateQueryFilters,
  MutationKey,
  MutationOptions,
  QueryFunction,
  QueryKey,
  QueryObserverOptions,
  QueryOptions,
  RefetchOptions,
} from './types'
import type { Query, QueryState, SetDataOptions } from './query'
import { QueryCache } from './queryCache'
import { QueriesObserver } from './queriesObserver'
import { QueryObserver } from './queryObserver'
import { initFocusHandler } from './focusHandler'
import { initOnlineHandler } from './onlineHandler'
import { notifyManager } from './notifyManager'
import { MutationCache } from './mutationCache'
import { MutationObserver } from './mutationObserver'
import type { Mutation, MutationState } from './mutation'

// TYPES

interface QueryClientConfig {
  queryCache?: QueryCache
  mutationCache?: MutationCache
  defaultOptions?: DefaultOptions
}

interface QueryDefaults {
  queryKey: QueryKey
  defaultOptions: QueryOptions<any, any, any>
}

interface MutationDefaults {
  mutationKey: MutationKey
  defaultOptions: MutationOptions<any, any, any, any>
}

// CLASS

export class QueryClient {
  private queryCache: QueryCache
  private mutationCache: MutationCache
  private defaultOptions: DefaultOptions
  private queryDefaults: QueryDefaults[]
  private mutationDefaults: MutationDefaults[]

  constructor(config: QueryClientConfig = {}) {
    this.queryCache = config.queryCache || new QueryCache()
    this.mutationCache = config.mutationCache || new MutationCache()
    this.defaultOptions = config.defaultOptions || {}
    this.queryDefaults = []
    this.mutationDefaults = []
  }

  mount(): void {
    mountedClients.push(this)
    initFocusHandler(onFocus)
    initOnlineHandler(onOnline)
  }

  unmount(): void {
    const index = mountedClients.indexOf(this)
    if (index > -1) {
      mountedClients.splice(index, 1)
    }
  }

  isFetching(filters?: QueryFilters): number
  isFetching(queryKey?: QueryKey, filters?: QueryFilters): number
  isFetching(arg1?: QueryKey | QueryFilters, arg2?: QueryFilters): number {
    const [filters] = parseFilterArgs(arg1, arg2)
    filters.fetching = true
    return this.queryCache.findAll(filters).length
  }

  getQueryData<TData = unknown>(
    queryKey: QueryKey,
    filters?: QueryFilters
  ): TData | undefined {
    return this.queryCache.find<TData>(queryKey, filters)?.state.data
  }

  setQueryData<TData>(
    queryKey: QueryKey,
    updater: Updater<TData | undefined, TData>,
    options?: SetDataOptions
  ): TData {
    const parsedOptions = parseQueryArgs(queryKey)
    const defaultedOptions = this.defaultQueryOptions(parsedOptions)
    return this.buildQuery(defaultedOptions).setData(updater, options)
  }

  getQueryState<TData = unknown, TError = undefined>(
    queryKey: QueryKey,
    filters?: QueryFilters
  ): QueryState<TData, TError> | undefined {
    return this.queryCache.find<TData, TError>(queryKey, filters)?.state
  }

  removeQueries(filters?: QueryFilters): void
  removeQueries(queryKey?: QueryKey, filters?: QueryFilters): void
  removeQueries(arg1?: QueryKey | QueryFilters, arg2?: QueryFilters): void {
    notifyManager.batch(() => {
      this.queryCache.findAll(arg1, arg2).forEach(query => {
        this.queryCache.remove(query)
      })
    })
  }

  cancelQueries(filters?: QueryFilters, options?: CancelOptions): Promise<void>
  cancelQueries(
    queryKey?: QueryKey,
    filters?: QueryFilters,
    options?: CancelOptions
  ): Promise<void>
  cancelQueries(
    arg1?: QueryKey | QueryFilters,
    arg2?: QueryFilters | CancelOptions,
    arg3?: CancelOptions
  ): Promise<void> {
    const [filters, options] = parseFilterArgs(arg1, arg2, arg3)
    const cancelOptions = options || {}

    if (typeof cancelOptions.revert === 'undefined') {
      cancelOptions.revert = true
    }

    const promises = notifyManager.batch(() =>
      this.queryCache.findAll(filters).map(query => query.cancel(cancelOptions))
    )

    return Promise.all(promises).then(noop).catch(noop)
  }

  invalidateQueries(
    filters?: InvalidateQueryFilters,
    options?: InvalidateOptions
  ): Promise<void>
  invalidateQueries(
    queryKey?: QueryKey,
    filters?: InvalidateQueryFilters,
    options?: InvalidateOptions
  ): Promise<void>
  invalidateQueries(
    arg1?: QueryKey | InvalidateQueryFilters,
    arg2?: InvalidateQueryFilters | InvalidateOptions,
    arg3?: InvalidateOptions
  ): Promise<void> {
    const [filters, options] = parseFilterArgs(arg1, arg2, arg3)

    const refetchFilters: QueryFilters = {
      ...filters,
      active: filters.refetchActive ?? true,
      inactive: filters.refetchInactive ?? false,
    }

    return notifyManager.batch(() => {
      this.queryCache.findAll(filters).forEach(query => {
        query.invalidate()
      })
      return this.refetchQueries(refetchFilters, options)
    })
  }

  refetchQueries(
    filters?: QueryFilters,
    options?: RefetchOptions
  ): Promise<void>
  refetchQueries(
    queryKey?: QueryKey,
    filters?: QueryFilters,
    options?: RefetchOptions
  ): Promise<void>
  refetchQueries(
    arg1?: QueryKey | QueryFilters,
    arg2?: QueryFilters | RefetchOptions,
    arg3?: RefetchOptions
  ): Promise<void> {
    const [filters, options] = parseFilterArgs(arg1, arg2, arg3)

    const promises = notifyManager.batch(() =>
      this.queryCache.findAll(filters).map(query => query.fetch())
    )

    let promise = Promise.all(promises).then(noop)

    if (!options?.throwOnError) {
      promise = promise.catch(noop)
    }

    return promise
  }

  watchQuery<
    TData = unknown,
    TError = unknown,
    TQueryFnData = TData,
    TQueryData = TQueryFnData
  >(
    options: QueryObserverOptions<TData, TError, TQueryFnData, TQueryData>
  ): QueryObserver<TData, TError, TQueryFnData, TQueryData>
  watchQuery<
    TData = unknown,
    TError = unknown,
    TQueryFnData = TData,
    TQueryData = TQueryFnData
  >(
    queryKey: QueryKey,
    options?: QueryObserverOptions<TData, TError, TQueryFnData, TQueryData>
  ): QueryObserver<TData, TError, TQueryFnData, TQueryData>
  watchQuery<
    TData = unknown,
    TError = unknown,
    TQueryFnData = TData,
    TQueryData = TQueryFnData
  >(
    queryKey: QueryKey,
    queryFn: QueryFunction<TQueryFnData | TData>,
    options?: QueryObserverOptions<TData, TError, TQueryFnData, TQueryData>
  ): QueryObserver<TData, TError, TQueryFnData, TQueryData>
  watchQuery<TData, TError, TQueryFnData = TData, TQueryData = TQueryFnData>(
    arg1:
      | QueryKey
      | QueryObserverOptions<TData, TError, TQueryFnData, TQueryData>,
    arg2?:
      | QueryFunction<TQueryFnData | TData>
      | QueryObserverOptions<TData, TError, TQueryFnData, TQueryData>,
    arg3?: QueryObserverOptions<TData, TError, TQueryFnData, TQueryData>
  ): QueryObserver<TData, TError, TQueryFnData, TQueryData> {
    const parsedOptions = parseQueryArgs(arg1, arg2, arg3)
    return new QueryObserver({ client: this, options: parsedOptions })
  }

  watchQueries(queries: QueryObserverOptions[]): QueriesObserver {
    return new QueriesObserver({ client: this, queries })
  }

  fetchQueryData<TData = unknown, TError = unknown, TQueryFnData = TData>(
    options: FetchQueryOptions<TData, TError, TQueryFnData>
  ): Promise<TData>
  fetchQueryData<TData = unknown, TError = unknown, TQueryFnData = TData>(
    queryKey: QueryKey,
    options?: FetchQueryOptions<TData, TError, TQueryFnData>
  ): Promise<TData>
  fetchQueryData<TData = unknown, TError = unknown, TQueryFnData = TData>(
    queryKey: QueryKey,
    queryFn: QueryFunction<TQueryFnData | TData>,
    options?: FetchQueryOptions<TData, TError, TQueryFnData>
  ): Promise<TData>
  fetchQueryData<TData, TError, TQueryFnData = TData>(
    arg1: QueryKey | FetchQueryOptions<TData, TError, TQueryFnData>,
    arg2?:
      | QueryFunction<TQueryFnData | TData>
      | FetchQueryOptions<TData, TError, TQueryFnData>,
    arg3?: FetchQueryOptions<TData, TError, TQueryFnData>
  ): Promise<TData> {
    const parsedOptions = parseQueryArgs(arg1, arg2, arg3)

    // https://github.com/tannerlinsley/react-query/issues/652
    if (typeof parsedOptions.retry === 'undefined') {
      parsedOptions.retry = false
    }

    const defaultedOptions = this.defaultQueryOptions(parsedOptions)

    let query = this.queryCache.find<TData, TError, TQueryFnData>(
      defaultedOptions.queryKey!
    )

    if (!query) {
      query = this.buildQuery(defaultedOptions)
    } else if (!query.isStaleByTime(defaultedOptions.staleTime)) {
      return Promise.resolve(query.state.data as TData)
    }

    return query.fetch(defaultedOptions)
  }

  prefetchQuery(options: FetchQueryOptions): Promise<void>
  prefetchQuery(queryKey: QueryKey, options?: FetchQueryOptions): Promise<void>
  prefetchQuery(
    queryKey: QueryKey,
    queryFn: QueryFunction,
    options?: FetchQueryOptions
  ): Promise<void>
  prefetchQuery(
    arg1: QueryKey | FetchQueryOptions,
    arg2?: QueryFunction | FetchQueryOptions,
    arg3?: FetchQueryOptions
  ): Promise<void> {
    return this.fetchQueryData(arg1 as any, arg2 as any, arg3)
      .then(noop)
      .catch(noop)
  }

  mutate<
    TData = unknown,
    TError = unknown,
    TVariables = void,
    TContext = unknown
  >(
    options: MutationOptions<TData, TError, TVariables, TContext>
  ): Promise<TData> {
    return this.buildMutation(options).execute()
  }

  watchMutation<
    TData = unknown,
    TError = unknown,
    TVariables = void,
    TContext = unknown
  >(
    options: MutationOptions<TData, TError, TVariables, TContext>
  ): MutationObserver<TData, TError, TVariables, TContext> {
    return new MutationObserver({ client: this, options })
  }

  buildMutation<
    TData = unknown,
    TError = unknown,
    TVariables = void,
    TContext = unknown
  >(
    options: MutationOptions<TData, TError, TVariables, TContext>
  ): Mutation<TData, TError, TVariables, TContext> {
    const defaultedOptions = this.defaultMutationOptions(options)
    return this.mutationCache.build(this, defaultedOptions)
  }

  restoreMutation<
    TData = unknown,
    TError = unknown,
    TVariables = void,
    TContext = unknown
  >(
    options: MutationOptions<TData, TError, TVariables, TContext>,
    state: MutationState<TData, TError, TVariables, TContext>
  ): Mutation<TData, TError, TVariables, TContext> {
    const defaultedOptions = this.defaultMutationOptions(options)
    return this.mutationCache.restore(this, defaultedOptions, state)
  }

  buildQuery<TData, TError, TQueryFnData>(
    options: QueryOptions<TData, TError, TQueryFnData>
  ): Query<TData, TError, TQueryFnData> {
    return this.queryCache.build(this, options)
  }

  restoreQuery<TData, TError, TQueryFnData>(
    options: QueryOptions<TData, TError, TQueryFnData>,
    state: QueryState<TData, TError>
  ): Query<TData, TError, TQueryFnData> {
    return this.queryCache.restore(this, options, state)
  }

  getQueryCache(): QueryCache {
    return this.queryCache
  }

  getMutationCache(): MutationCache {
    return this.mutationCache
  }

  getDefaultOptions(): DefaultOptions {
    return this.defaultOptions
  }

  setDefaultOptions(options: DefaultOptions): void {
    this.defaultOptions = options
  }

  setQueryDefaults(
    queryKey: QueryKey,
    options: QueryOptions<any, any, any>
  ): void {
    const result = this.queryDefaults.find(x =>
      partialDeepEqual(x.queryKey, queryKey)
    )
    if (result) {
      result.defaultOptions = options
    } else {
      this.queryDefaults.push({ queryKey, defaultOptions: options })
    }
  }

  getQueryDefaults(
    queryKey: QueryKey
  ): QueryOptions<any, any, any> | undefined {
    return this.queryDefaults.find(x => partialDeepEqual(x.queryKey, queryKey))
      ?.defaultOptions
  }

  setMutationDefaults(
    mutationKey: MutationKey,
    options: MutationOptions<any, any, any, any>
  ): void {
    const result = this.mutationDefaults.find(x =>
      partialDeepEqual(x.mutationKey, mutationKey)
    )
    if (result) {
      result.defaultOptions = options
    } else {
      this.mutationDefaults.push({ mutationKey, defaultOptions: options })
    }
  }

  getMutationDefaults(
    mutationKey: MutationKey
  ): MutationOptions<any, any, any, any> | undefined {
    return this.mutationDefaults.find(x =>
      partialDeepEqual(x.mutationKey, mutationKey)
    )?.defaultOptions
  }

  defaultQueryOptions<T extends QueryOptions<any, any>>(options?: T): T {
    return { ...this.defaultOptions.queries, ...options } as T
  }

  defaultQueryObserverOptions<T extends QueryObserverOptions<any, any>>(
    options?: T
  ): T {
    return { ...this.defaultOptions.queries, ...options } as T
  }

  defaultMutationOptions<T extends MutationOptions<any, any, any, any>>(
    options?: T
  ): T {
    return { ...this.defaultOptions.mutations, ...options } as T
  }

  clear(): void {
    this.queryCache.clear()
    this.mutationCache.clear()
  }
}

const mountedClients: QueryClient[] = []

function getQueryCaches() {
  return uniq(mountedClients.map(client => client.getQueryCache()))
}

function getMutationCaches() {
  return uniq(mountedClients.map(client => client.getMutationCache()))
}

function onFocus() {
  if (isVisibleAndOnline()) {
    getMutationCaches().forEach(cache => {
      cache.onFocus()
    })
    getQueryCaches().forEach(cache => {
      cache.onFocus()
    })
  }
}

function onOnline() {
  if (isVisibleAndOnline()) {
    getMutationCaches().forEach(cache => {
      cache.onOnline()
    })
    getQueryCaches().forEach(cache => {
      cache.onOnline()
    })
  }
}
