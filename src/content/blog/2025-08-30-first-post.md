---
title: "First post"
pubDate: 2025-08-30
description: "About this blog"
---

I was thinking about having a blog for years. Finally, I have set one up. I have a few projects I want to write about here, but in this post, I'll just share what it took to set this up.

## Static site generators

This website uses [Astro](https://astro.build). I use it as a static site generator, although Astro describes itself as a web framework.

Initially, I was thinking about using something simpler and more approachable. My main idea was to get something up and running with minimal effort and improve it later. There are a lot of static site generators out there:  

- [Jekyll](https://jekyllrb.com) was the first thing that came to my mind, mostly because it is the default static site generator used with [GitHub Pages](https://docs.github.com/en/pages). I never really tried it though. It is written in Ruby and distributed as source code, so to use it, you need Ruby installed. I've never used Ruby and have no intention of doing so now, so I decided to pass on it.  
- [Hugo](https://gohugo.io/) is written in Go and is one of the first static site generators you come across when searching for one. I have no problem having Go installed and I am quite familiar with the tools, but even if that wasn't the case, Hugo can be installed as an executable and there is no need to compile it. It looked like a strong choice.  
- [Zola](https://www.getzola.org/) is written in Rust, and I must admit that I love Rust, so for me, “written in Rust” is a feature. I actually played with Zola for a while.  
- And, of course, there are many more.

Astro wasn’t even on my list at first, but in the end, I ended up using it.

## Diff syntax highlighting

One of the features I wanted was **diff syntax highlighting**, and by that I mean highlighting changes in code **without losing the highlighting of the language** it is written in. Most of the tools I looked at did not support that.

I even tried to implement it for [syntect](https://github.com/trishume/syntect), the syntax highlighter used in Zola. I managed to build a simple prototype, but that was it — I never found time to look into integrating it with Zola itself.

I also integrated [diff2html](https://diff2html.xyz/) with [mdBook](https://github.com/rust-lang/mdBook): [mdbook-diff2html](https://github.com/romamik/mdbook-diff2html), but I didn’t finish the project I made it for.

And a couple of days ago, I stumbled upon [Expressive Code](https://expressive-code.com/). It had all the features I wanted and more: it can [show diffs](https://expressive-code.com/key-features/text-markers/#using-diff-like-syntax), [make parts of code collapsible](https://expressive-code.com/key-features/text-markers/#using-diff-like-syntax), and [add line markers with labels](https://expressive-code.com/key-features/text-markers/#adding-labels-to-line-markers).

Here is a demo:

```rs wrap line-numbers collapse={1-13, 22-32} collapseStyle=collapsible-auto del={18} ins={19}
use typed_eval::{Compiler, SupportedType};

#[derive(SupportedType)]
struct User {
    name: String,
    age: i64,
}

#[derive(SupportedType)]
struct Context {
    user: User,
    greet: Box<dyn Fn(String) -> String>,
}

fn main() {
    let compiler = Compiler::new();

    let greet_user = compiler.compile::<String>("greet(user.name)").unwrap();
    let greet_user = compiler.compile("greet(user.name)").unwrap();
    let double_age = compiler.compile::<i64>("user.age * 2").unwrap();

    let context = Context {
        user: User {
            name: "Bob".into(),
            age: 45,
        },
        greet: Box::new(|name| format!("Hello, {name}")),
    };

    assert_eq!(greet_user.call(&context), "Hello, Bob");
    assert_eq!(double_age.call(&context), 90);
}
```

The most straightforward way to use Expressive Code seemed to be with Astro. They also mention Starlight, which is a tool for building documentation websites, and Next.js, which from my understanding is tightly coupled with React — and I wanted my site to be mostly static.

## Dark/light theme

I always wanted to have a dark/light theme switch, so I added one to this site, and it has three options: dark, light, and auto. It uses JavaScript for switching between the themes, and there is a fallback when JavaScript is disabled. Integrating it with syntax highlighting did not take too much effort.

## Table of contents

There is also an automatically generated table of contents for every blog post. It took some time to make it work as intended, mostly because I wanted to make it responsive, and also because of the fixed header that messed up automatic scrolling. But eventually, it works.

## Conclusion

This was the first post on the blog. While I still have some features in mind that I want to add, I can finally write a blog post whenever I want. I already have some ideas and hope to post something in the coming days.