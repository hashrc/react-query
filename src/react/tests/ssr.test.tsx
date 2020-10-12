/**
 * @jest-environment node
 */

import React from 'react'
// @ts-ignore
import { renderToString } from 'react-dom/server'

import { sleep, queryKey } from './utils'
import { useQuery, QueryClient, QueryClientProvider } from '../..'

describe('Server Side Rendering', () => {
  it('should not trigger fetch', () => {
    const client = new QueryClient()
    const key = queryKey()
    const queryFn = jest.fn()

    function Page() {
      const query = useQuery(key, queryFn)

      const content = `status ${query.status}`

      return (
        <div>
          <div>{content}</div>
        </div>
      )
    }

    const markup = renderToString(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    )

    expect(markup).toContain('status loading')
    expect(queryFn).toHaveBeenCalledTimes(0)
    client.clear()
  })

  it('should add prefetched data to cache', async () => {
    const client = new QueryClient()
    const key = queryKey()
    const fetchFn = () => Promise.resolve('data')
    const data = await client.fetchQueryData(key, fetchFn)
    expect(data).toBe('data')
    expect(client.getQueryCache().find(key)?.state.data).toBe('data')
    client.clear()
  })

  it('should return existing data from the cache', async () => {
    const client = new QueryClient()
    const key = queryKey()
    const queryFn = jest.fn(() => sleep(10))

    function Page() {
      const query = useQuery(key, queryFn)

      const content = `status ${query.status}`

      return (
        <div>
          <div>{content}</div>
        </div>
      )
    }

    await client.prefetchQuery(key, queryFn)

    const markup = renderToString(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    )

    expect(markup).toContain('status success')
    expect(queryFn).toHaveBeenCalledTimes(1)
    client.clear()
  })

  it('should add initialData to the cache', () => {
    const key = queryKey()

    const client = new QueryClient()

    function Page() {
      const [page, setPage] = React.useState(1)
      const { data } = useQuery(
        [key, page],
        async (_: string, pageArg: number) => {
          return pageArg
        },
        { initialData: 1 }
      )

      return (
        <div>
          <h1 data-testid="title">{data}</h1>
          <button onClick={() => setPage(page + 1)}>next</button>
        </div>
      )
    }

    renderToString(
      <QueryClientProvider client={client}>
        <Page />
      </QueryClientProvider>
    )

    const keys = client
      .getQueryCache()
      .getAll()
      .map(query => query.queryKey)

    expect(keys).toEqual([[key, 1]])
    client.clear()
  })
})
