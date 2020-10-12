import { sleep } from '../../react/tests/utils'
import { QueryClient } from '../..'
import { dehydrate, hydrate } from '../hydration'

async function fetchData<TData>(value: TData, ms?: number): Promise<TData> {
  await sleep(ms || 0)
  return value
}

describe('dehydration and rehydration', () => {
  test('should work with serializeable values', async () => {
    const client = new QueryClient()
    await client.prefetchQuery('string', () => fetchData('string'))
    await client.prefetchQuery('number', () => fetchData(1))
    await client.prefetchQuery('boolean', () => fetchData(true))
    await client.prefetchQuery('null', () => fetchData(null))
    await client.prefetchQuery('array', () => fetchData(['string', 0]))
    await client.prefetchQuery('nested', () =>
      fetchData({ key: [{ nestedKey: 1 }] })
    )
    const dehydrated = dehydrate(client)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationClient = new QueryClient()
    hydrate(hydrationClient, parsed)
    const hydrationCache = hydrationClient.getQueryCache()
    expect(hydrationCache.find('string')?.state.data).toBe('string')
    expect(hydrationCache.find('number')?.state.data).toBe(1)
    expect(hydrationCache.find('boolean')?.state.data).toBe(true)
    expect(hydrationCache.find('null')?.state.data).toBe(null)
    expect(hydrationCache.find('array')?.state.data).toEqual(['string', 0])
    expect(hydrationCache.find('nested')?.state.data).toEqual({
      key: [{ nestedKey: 1 }],
    })

    const fetchDataAfterHydration = jest.fn()
    await hydrationClient.prefetchQuery('string', fetchDataAfterHydration, {
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery('number', fetchDataAfterHydration, {
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery('boolean', fetchDataAfterHydration, {
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery('null', fetchDataAfterHydration, {
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery('array', fetchDataAfterHydration, {
      staleTime: 1000,
    })
    await hydrationClient.prefetchQuery('nested', fetchDataAfterHydration, {
      staleTime: 1000,
    })
    expect(fetchDataAfterHydration).toHaveBeenCalledTimes(0)

    client.clear()
    hydrationClient.clear()
  })

  test('should schedule garbage collection, measured from hydration', async () => {
    const client = new QueryClient()
    await client.prefetchQuery('string', () => fetchData('string'), {
      cacheTime: 50,
    })
    const dehydrated = dehydrate(client)
    const stringified = JSON.stringify(dehydrated)

    await sleep(20)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationClient = new QueryClient()
    hydrate(hydrationClient, parsed)
    const hydrationCache = hydrationClient.getQueryCache()
    expect(hydrationCache.find('string')?.state.data).toBe('string')
    await sleep(30)
    expect(hydrationCache.find('string')).toBeTruthy()
    await sleep(30)
    expect(hydrationCache.find('string')).toBeFalsy()

    client.clear()
    hydrationClient.clear()
  })

  test('should serialize the cacheTime correctly', async () => {
    const client = new QueryClient()
    await client.prefetchQuery('string', () => fetchData('string'), {
      cacheTime: Infinity,
    })
    const dehydrated = dehydrate(client)
    const stringified = JSON.stringify(dehydrated)
    const parsed = JSON.parse(stringified)
    const hydrationClient = new QueryClient()
    const hydrationCache = hydrationClient.getQueryCache()
    hydrate(hydrationClient, parsed)
    expect(hydrationCache.find('string')?.cacheTime).toBe(Infinity)
    client.clear()
    hydrationClient.clear()
  })

  test('should be able to provide default options for the hydrated queries', async () => {
    const client = new QueryClient()
    await client.prefetchQuery('string', () => fetchData('string'))
    const dehydrated = dehydrate(client)
    const stringified = JSON.stringify(dehydrated)
    const parsed = JSON.parse(stringified)
    const hydrationClient = new QueryClient()
    const hydrationCache = hydrationClient.getQueryCache()
    hydrate(hydrationClient, parsed, { defaultOptions: { retry: 10 } })
    expect(hydrationCache.find('string')?.options.retry).toBe(10)
    client.clear()
    hydrationClient.clear()
  })

  test('should work with complex keys', async () => {
    const client = new QueryClient()
    await client.prefetchQuery(['string', { key: ['string'], key2: 0 }], () =>
      fetchData('string')
    )
    const dehydrated = dehydrate(client)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationClient = new QueryClient()
    const hydrationCache = hydrationClient.getQueryCache()
    hydrate(hydrationClient, parsed)
    expect(
      hydrationCache.find(['string', { key: ['string'], key2: 0 }])?.state.data
    ).toBe('string')

    const fetchDataAfterHydration = jest.fn()
    await hydrationClient.prefetchQuery(
      ['string', { key: ['string'], key2: 0 }],
      fetchDataAfterHydration,
      { staleTime: 10 }
    )
    expect(fetchDataAfterHydration).toHaveBeenCalledTimes(0)

    client.clear()
    hydrationClient.clear()
  })

  test('should only hydrate successful queries by default', async () => {
    const consoleMock = jest.spyOn(console, 'error')
    consoleMock.mockImplementation(() => undefined)

    const client = new QueryClient()
    await client.prefetchQuery('success', () => fetchData('success'))
    client.prefetchQuery('loading', () => fetchData('loading', 10000))
    await client.prefetchQuery('error', () => {
      throw new Error()
    })
    const dehydrated = dehydrate(client)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationClient = new QueryClient()
    const hydrationCache = hydrationClient.getQueryCache()
    hydrate(hydrationClient, parsed)

    expect(hydrationCache.find('success')).toBeTruthy()
    expect(hydrationCache.find('loading')).toBeFalsy()
    expect(hydrationCache.find('error')).toBeFalsy()

    client.clear()
    hydrationClient.clear()
    consoleMock.mockRestore()
  })

  test('should filter queries via shouldDehydrate', async () => {
    const client = new QueryClient()
    await client.prefetchQuery('string', () => fetchData('string'))
    await client.prefetchQuery('number', () => fetchData(1))
    const dehydrated = dehydrate(client, {
      shouldDehydrate: query => query.queryKey !== 'string',
    })

    // This is testing implementation details that can change and are not
    // part of the public API, but is important for keeping the payload small
    const dehydratedQuery = dehydrated?.queries.find(
      query => query?.queryKey === 'string'
    )
    expect(dehydratedQuery).toBeUndefined()

    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationClient = new QueryClient()
    const hydrationCache = hydrationClient.getQueryCache()
    hydrate(hydrationClient, parsed)
    expect(hydrationCache.find('string')).toBeUndefined()
    expect(hydrationCache.find('number')?.state.data).toBe(1)

    client.clear()
    hydrationClient.clear()
  })

  test('should not overwrite query in cache if hydrated query is older', async () => {
    const client = new QueryClient()
    await client.prefetchQuery('string', () => fetchData('string-older', 5))
    const dehydrated = dehydrate(client)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    const hydrationClient = new QueryClient()
    const hydrationCache = hydrationClient.getQueryCache()
    await hydrationClient.prefetchQuery('string', () =>
      fetchData('string-newer', 5)
    )

    hydrate(hydrationClient, parsed)
    expect(hydrationCache.find('string')?.state.data).toBe('string-newer')

    client.clear()
    hydrationClient.clear()
  })

  test('should overwrite query in cache if hydrated query is newer', async () => {
    const hydrationClient = new QueryClient()
    const hydrationCache = hydrationClient.getQueryCache()
    await hydrationClient.prefetchQuery('string', () =>
      fetchData('string-older', 5)
    )

    // ---

    const client = new QueryClient()
    await client.prefetchQuery('string', () => fetchData('string-newer', 5))
    const dehydrated = dehydrate(client)
    const stringified = JSON.stringify(dehydrated)

    // ---

    const parsed = JSON.parse(stringified)
    hydrate(hydrationClient, parsed)
    expect(hydrationCache.find('string')?.state.data).toBe('string-newer')

    client.clear()
    hydrationClient.clear()
  })
})
