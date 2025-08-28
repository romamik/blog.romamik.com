import { getCollection } from "astro:content";

export async function getPosts() {
  const isDev = import.meta.env.MODE === "development";

  const posts = await getCollection("blog", ({ data }) => isDev || !data.draft);

  return posts.sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime()
  );
}
