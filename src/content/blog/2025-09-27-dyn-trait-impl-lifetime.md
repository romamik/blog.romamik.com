---
title: "dyn trait lifetimes"
pubDate: 2025-09-27
description: ""
draft: true
---

I just stumbled upon [Rust Quiz](https://dtolnay.github.io/rust-quiz). Normally I am not a fan of questions like: what will be the output of this obscure program that uses abnormal syntax. Don't write obscure syntax and you will not need to guess is my answer to this. But this quiz seems a bit different so far.

## The Question

This post is not about the quiz itself though. In the [question #10](https://dtolnay.github.io/rust-quiz/10), the code includes:

```rs
impl<'a> dyn Trait + 'a {
    fn f(&self) {
        print!("1");
    }
}
```

The whole code happily compiles without mention of the lifetime:

```rs
impl dyn Trait {
    fn f(&self) {
        print!("1");
    }
}
```

So, I was wondering, why did **Dtolnay** added it there? Was it only to make the problem more obscure? Or, a more meaningful question, what does it mean when written like this?

**Note**: This is not what the question in the quiz is about at all.

## The Answer

As always, the answer can be found in the [Rust reference](https://doc.rust-lang.org/stable/reference/).

Namely in the [Trait objects](https://doc.rust-lang.org/stable/reference/types/trait-object.html) section.

> Since a trait object can contain references, the lifetimes of those references need to be expressed as part of the trait object. This lifetime is written as Trait + 'a. There are [defaults](https://doc.rust-lang.org/stable/reference/lifetime-elision.html#default-trait-object-lifetimes) that allow this lifetime to usually be inferred with a sensible choice.

So, the `'a` lifetime time here refers to the references contained in the trait object.

If we follow the link on "defaults":

> If the trait has no lifetime bounds, then the lifetime ... is 'static outside of expressions.

In other words, if we do not specify a lifetime, `'static` lifetime is used. Or,

```rs
impl dyn Trait {}
```

is equivalent to

```rs
impl dyn Trait + 'static {}
```

Here is the example code that uses all three variants mentioned: named lifetime, static lifetime and implicit lifetime, which is also static:

```rs
struct Foo<'a> {
    field: &'a i32,
}

trait Trait {}
impl<'a> Trait for Foo<'a> {}

impl dyn Trait {
    fn implicit_lifetime(&self) {}
}

impl dyn Trait + 'static {
    fn static_lifetime(&self) {}
}

impl<'a> dyn Trait + 'a {
    fn explicit_lifetime(&self) {}
}

fn main() {
    let int = 10;
    let foo = Foo { field: &int };
    
    let trait_object: &dyn Trait = &foo;
    
    // does not compile: `int` does not live long enough
    // trait_object.implicit_lifetime(); 

    // does not compile: `int` does not live long enough
    // trait_object.static_lifetime(); 

    // successfully compiles
    trait_object.explicit_lifetime();
}
```

This illustrates that the 'a is not redundant: it allows trait objects that hide non-'static types. 