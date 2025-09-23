import rss from "@astrojs/rss";
import { getPosts } from "../lib/blog";

export async function GET(context) {
  return rss({
    title: "blog.romamik.com",
    description: "romamik's blog",
    site: context.site,
    items: (await getPosts()).map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      // Compute RSS link from post `id`
      // This example assumes all posts are rendered as `/blog/[id]` routes
      link: `/blog/${post.slug}/`,
    })),
    customData: `<language>en-us</language>`,
  });
}
