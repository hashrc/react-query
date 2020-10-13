import React from 'react'
import { QueryClient } from 'react-query'
import { dehydrate } from 'react-query/hydration'

import { Layout, Header, InfoBox, PostList } from '../components'
import { fetchPosts } from '../hooks'

const Home = () => {
  return (
    <Layout>
      <Header />
      <InfoBox>ℹ️ This page shows how to use SSG with React-Query.</InfoBox>
      <PostList />
    </Layout>
  )
}

export async function getStaticProps() {
  const client = new QueryClient()
  await client.prefetchQuery(['posts', 10], fetchPosts)

  return {
    props: {
      dehydratedState: dehydrate(client),
    },
  }
}

export default Home
