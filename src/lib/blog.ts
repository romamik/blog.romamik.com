import { getCollection } from "astro:content";

export type BlogPost = Awaited<ReturnType<typeof getCollection>>[number] & {
  formattedDate: string;
};

export async function getPosts(): Promise<BlogPost[]> {
  const isDev = import.meta.env.MODE === "development";

  const posts = await getCollection("blog", ({ data }) => isDev || !data.draft);

  return posts
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime())
    .map((post) => ({
      ...post,
      formattedDate: post.data.pubDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "2-digit",
      }),
    }));
}
