import React from 'react'
import { render } from '@testing-library/react'

import { QueryClient, QueryClientProvider, useQuery } from '../..'
import { dehydrate, useHydrate, Hydrate } from '../'
import { sleep } from '../../react/tests/utils'

describe('React hydration', () => {
  const fetchData: (value: string) => Promise<string> = value =>
    new Promise(res => setTimeout(() => res(value), 10))
  const dataQuery: (key: string) => Promise<string> = key => fetchData(key)
  let stringifiedState: string

  beforeAll(async () => {
    const client = new QueryClient()
    await client.prefetchQuery('string', dataQuery)
    const dehydrated = dehydrate(client)
    stringifiedState = JSON.stringify(dehydrated)
    client.clear()
  })

  describe('useHydrate', () => {
    test('should hydrate queries to the cache on context', async () => {
      const dehydratedState = JSON.parse(stringifiedState)
      const client = new QueryClient()

      function Page() {
        useHydrate(dehydratedState)
        const { data } = useQuery('string', dataQuery)
        return (
          <div>
            <h1>{data}</h1>
          </div>
        )
      }

      const rendered = render(
        <QueryClientProvider client={client}>
          <Page />
        </QueryClientProvider>
      )

      await sleep(10)
      rendered.getByText('string')
      client.clear()
    })
  })

  describe('ReactQueryCacheProvider with hydration support', () => {
    test('should hydrate new queries if queries change', async () => {
      const dehydratedState = JSON.parse(stringifiedState)
      const client = new QueryClient()

      function Page({ queryKey }: { queryKey: string }) {
        const { data } = useQuery(queryKey, dataQuery)
        return (
          <div>
            <h1>{data}</h1>
          </div>
        )
      }

      const rendered = render(
        <QueryClientProvider client={client}>
          <Hydrate state={dehydratedState}>
            <Page queryKey={'string'} />
          </Hydrate>
        </QueryClientProvider>
      )

      await sleep(10)
      rendered.getByText('string')

      const intermediateClient = new QueryClient()
      await intermediateClient.prefetchQuery('string', () =>
        dataQuery('should change')
      )
      await intermediateClient.prefetchQuery('added string', dataQuery)
      const dehydrated = dehydrate(intermediateClient)
      intermediateClient.clear()

      rendered.rerender(
        <QueryClientProvider client={client}>
          <Hydrate state={dehydrated}>
            <Page queryKey={'string'} />
            <Page queryKey={'added string'} />
          </Hydrate>
        </QueryClientProvider>
      )

      // Existing query data should be overwritten if older,
      // so this should have changed
      await sleep(10)
      rendered.getByText('should change')
      // New query data should be available immediately
      rendered.getByText('added string')

      client.clear()
    })

    test('should hydrate queries to new cache if cache changes', async () => {
      const dehydratedState = JSON.parse(stringifiedState)
      const client = new QueryClient()

      function Page() {
        const { data } = useQuery('string', dataQuery)
        return (
          <div>
            <h1>{data}</h1>
          </div>
        )
      }

      const rendered = render(
        <QueryClientProvider client={client}>
          <Hydrate state={dehydratedState}>
            <Page />
          </Hydrate>
        </QueryClientProvider>
      )

      await sleep(10)
      rendered.getByText('string')

      const newClientQueryClient = new QueryClient()

      rendered.rerender(
        <QueryClientProvider client={newClientQueryClient}>
          <Hydrate state={dehydratedState}>
            <Page />
          </Hydrate>
        </QueryClientProvider>
      )

      await sleep(10)
      rendered.getByText('string')

      client.clear()
      newClientQueryClient.clear()
    })
  })
})
