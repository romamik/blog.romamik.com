---
title: "First post"
pubDate: 2025-08-30
description: "About this blog"
---

I had been thinking about having a blog for years. I've finally set one up. I have a few projects I want to write about here, but in this post, I'll just share a bit about the blog itself.

## Astro

This website uses [Astro](https://astro.build). I use it as a static site generator, although Astro describes itself as a web framework. I had never used it before, but for my simple use case, it was straightforward. I was building something in less than 10 minutes after I got to their website.

Initially, I was planning to use a simple static site generator, like [Zola](https://www.getzola.org/). But there was one feature I really wanted: diff syntax highlighting, which means highlighting code changes without losing the highlighting of the language itself. Most of the tools I looked at did not support that. So, when I stumbled upon [Expressive Code](https://expressive-code.com/) which had this and many other features, I decided it was exactly what I needed. It turned out that the easiest way to use it was with Astro.

Here’s a small demo of a code block with a code diff:

```diff lang=rs
fn main() {
+     println!("Hello world!")
-     println!()
}
```

## Layout

The site's layout is simple, and I used [tailwindcss](https://tailwindcss.com/) without any component frameworks. Since Tailwind CSS resets all styles by default, I used the [tailwindcss-typography](https://github.com/tailwindlabs/tailwindcss-typography) plugin, which provides styles for headings, lists, paragraphs, and more.

There is a fixed header at the top of the page, implemented as an element with `position: fixed`. The main element has a top padding so that it is not covered by the header. This feels a bit hacky to me, but it is actually a very common approach. Because of this, I had a problem when navigating to links on the same page. By default, browsers scroll the page so that the target element is at the top of the screen, but in my case, this meant the element would be hidden behind the header. I fixed this with the following CSS code, which creates a displaced element before the target that is taken into account during scrolling:

```css
/* fix scrolling by anchor, take account for fixed header */
:target::before {
  content: "";
  display: block;
  height: --spacing(12); /* fixed header height*/
  margin: --spacing(-12) 0 0; /* negative fixed header height */
}
```

## Dark and light themes

One of the features I wanted to have was the ability to switch between dark and light themes. There are actually three possible values for the switch: light, dark, and auto.

To specify colors in the layout, I chose the simplest possible method: Tailwind CSS already has a [dark mode](https://tailwindcss.com/docs/dark-mode) so it's possible to write code like this:

```html
<div class="bg-white text-black dark:bg-black dark:text-white"></div>
```

Switching between the themes is done using JavaScript. I set the `data-theme` attribute of the root element and in my CSS, I have `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` as shown in the Tailwind CSS docs.

This approach caused a small problem: when the page loads, the `data-theme` attribute is set by JavaScript after the page has been shown. So, if dark mode is selected, the page first loads with the light theme and then switches to dark. I solved this with the following CSS code, which is accompanied by JavaScript code that removes the `no-js` class from the root element:

```css
/* 
prevent flickering when selecting dark mode after page load: do not show anything before theme is selected 
but only if js is enabled 
*/
html:not(.no-js):not([data-theme]) body {
  display: none;
}
```

### Dark and light themes with Expressive Code

By default, Expressive Code supports switching between dark and light themes, but does this automatcally depending on user preferences. I obviousy wanted it to switch with the rest of the site. Hopefully, they provide a way to support theme switching, this can be done by setting the `useDarkModeMediaQuery` setting to `false`, and providing a `themeCssSelector` callback function, that works in a way that I did not expect, even though it works in a quite logical way.

When I was thinking about configuring Expressive Code to switch themes depending on the site setting, I was thinking in terms of directly setting the theme when it is needed, something like: if the theme is dark, please use the code theme `github-dark`. But actually the `themeCssSelector` callback works the other way around: for each Expressive Code theme it provides a css selector, that will be used to activate it. It is called at the build time, and is used to generate a CSS for the code blocks.

## Table of Contents

There is an automatically generated table of contents for each blog post.

Astro provides a [list of headings](https://docs.astro.build/en/guides/markdown-content/#heading-ids) after parsing a Markdown document. It provides them as a plain list with a `depth` property, which is 1 for `h1`, 2 for `h2`, and so on. I build a tree of headers from this and then render it as nested `<ul>` elements. It turns out that rendering a recursive structure in Astro isn’t very intuitive. I ended up creating a separate layout that uses [Astro.self](https://docs.astro.build/en/reference/astro-syntax/#astroself), and I had to search online to find this solution.

It would be very handy to have a function that returns JSX, but this isn't supported in Astro:

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

This was the first post on the blog. I really hope to find time to write the next one, as I already have some ideas to share.
