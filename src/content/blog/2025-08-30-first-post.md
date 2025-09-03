---
title: "First post"
pubDate: 2025-08-30
description: "About this blog"
---

I was thinking about having a blog for years. Finally, I have set one up. I have a few projects I want to write about here, but in this post, I'll just share a bit about the blog itself.

## Astro

This website uses [Astro](https://astro.build). I use it as a static site generator, although Astro describes itself as a web framework. I never used it before, but for my simple usecase it was straightforward and I was building something in less then 10 minutes after getting to their website. 

Initially, I was planning to use a simple static site generator, like for example [Zola](https://www.getzola.org/). But there was one feature I really wanted to have: diff syntax highlighting, and by that I mean highlighting changes in code without losing the highlighting of the language itself. Most of the tools I looked at did not support that. So, when I stumbled upon [Expressive Code](https://expressive-code.com/) which had this feature and many others, I decided that it is what I need, and it turned out that the easiest way to have it was to use Astro. 

Just a little demo of the code block with the code diff:
```diff language=rs
fn main() {
+     println!("Hello world!")
-     println!()
}
```

## Layout

The layout of the site is simple and I used [tailwindcss](https://tailwindcss.com/) for it without any component frameworks. As tailwind itself resets all styles for all elements, I used [tailwindcss-typography](https://github.com/tailwindlabs/tailwindcss-typography) plugin, which provides styles for headings, lists, paragraphs, etc.

There is a fixed header above the page, it is implemented as a fixed element and the main element has a top padding so that it is not covered by the header. For me, this feels hacky, but actually it is a very common approach. There was a problem when navigating between a links on the same page because of this: by default browsers scroll the page so that the target element is on top of the screen, and in my case that meant that such element would be behind the header when scrolled to. This was fixed by this css code, which creates a displaced element before the target, and this element is taken into account when scrolling:
```css
/* fix scrolling by anchor, take account for fixed header */
:target::before {
  content: "";
  display: block;
  height: --spacing(12); /* fixed header height*/
  margin: --spacing(-12) 0 0; /* negative fixed header height */
}
```

## Dark and light theme

One of the features I decided to have was switching between the dark and light themes. Actually there are three possible values for the switch: light, dark, and auto. 

As for the specifying colors in the layout I went with the simplest possible way: tailwind already has the [dark mode](https://tailwindcss.com/docs/dark-mode) so it is possible to write something like this:
```html
<div class="bg-white text-black dark:bg-black dark:text-white"></div>
```

The switching between the themes is done using javascript. I set the `data-theme` attribute of the root element and in css I have `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` as per tailwindcss docs. 

This approach caused a small problem: when the page loads the `data-theme` attribute is set by javascript later then the page is shown, so if the dark mode is selected the page first loads with light theme and then switches to dark. I solved this with this css code, which is accompanied with the javascript code that removes the `no-js` class from the root element:
```css
/* 
prevent flickering when selecting dark mode after page load: do not show anything before theme is selected 
but only if js is enabled 
*/
html:not(.no-js):not([data-theme]) body {
  display: none;
}
```

## Table of Contents

There is an automatically generated table of contents for each blog post. 

Astro provides [a list of headings](https://docs.astro.build/en/guides/markdown-content/#heading-ids) after parsing a Markdown document. It provides them as a plain list with a `depth` property which would 1 for `h1`, 2 for `h2` etc. I build a tree of headers from this and then render it as nested `<ul>` elements. It turned out that rendering a recursive structure in Astro is not very intuitive. I ended up creating a separate layout using [Astro.self](https://docs.astro.build/en/reference/astro-syntax/#astroself). And I had to google to find this solution.

It would be very handy to be able to have a function that returns jsx, but this is not supported in Astro:
```js
// THIS WILL NOT WORK IN ASTRO
// use Astro.self instead
function renderHeadings(headings: Heading[]) {
  return (
    <ul>
      {headings.map((heading) => (
        <li>
          <a href={`#${heading.slug}`}>{heading.text}</a>
          {heading.children &&
            heading.children.length > 0 &&
            renderHeadings(heading.children)}
        <li/>
      ))}
    </ul>
  );
}
```

## Final words

This was the first post on the blog. I really hope to find time to write the next one as I already have some ideas to share. 