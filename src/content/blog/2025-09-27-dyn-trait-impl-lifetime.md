---
title: "The Mystery of Rust Quiz #10"
pubDate: 2025-09-27
description: "Why specifying a lifetime on `impl` blocks for trait objects matters in Rust."
draft: true
---

I just stumbled upon [Rust Quiz](https://dtolnay.github.io/rust-quiz). Normally, I am not a fan of questions like: _what will be the output of this obscure program that uses abnormal syntax_. My answer is usually: _Don't write obscure syntax and you won't need to guess_. But this quiz seems a bit different so far.

## The Question

This post is not about the quiz itself. In [question #10](https://dtolnay.github.io/rust-quiz/10), the code includes:

```rs
impl<'a> dyn Trait + 'a {
    fn f(&self) {
        print!("1");
    }
}
```

Note that here we are writing an `impl` block **for a trait object type** (`dyn Trait`), not implementing a trait for a concrete type. This is relatively uncommon in Rust. A familiar example from the standard library is `impl dyn Any`, which defines inherent methods on the trait object itself, but does **not** include an explicit lifetime.

While the question is totally unrelated to the lifetime in this snippet, it made me wonder why it is there. Interestingly, the code also happily compiles without mentioning the lifetime:

```rs
impl dyn Trait {
    fn f(&self) {
        print!("1");
    }
}
```

So why did **Dtolnay** add the `'a` there? Is it just to make the problem more obscure, or is there a deeper meaning?

## The Answer

The key is in the [Rust reference on trait objects](https://doc.rust-lang.org/stable/reference/types/trait-object.html):

> Since a trait object can contain references, the lifetimes of those references need to be expressed as part of the trait object. This lifetime is written as Trait + 'a. There are [defaults](https://doc.rust-lang.org/stable/reference/lifetime-elision.html#default-trait-object-lifetimes) that allow this lifetime to usually be inferred with a sensible choice.

In short: `'a` specifies how long references **inside the trait object** are allowed to live. If we don’t explicitly write it, Rust uses a default.

From the link on defaults:

> If the trait has no lifetime bounds, then the lifetime ... is 'static outside of expressions.

That means:

```rs
impl dyn Trait {}
```

is actually equivalent to:

```rs
impl dyn Trait + 'static {}
```

So if you don’t specify a lifetime, Rust assumes the trait object will only hold references that live for `'static`.

## Example Code

Here is a complete example showing all three variants: named lifetime, static lifetime, and implicit lifetime (which is also `'static`):

```rs
struct Foo<'a> {
    field: &'a i32,
}

trait Trait {}
impl<'a> Trait for Foo<'a> {}

// implicit lifetime (defaults to 'static)
impl dyn Trait {
    fn implicit_lifetime(&self) {}
}

// explicit 'static lifetime
impl dyn Trait + 'static {
    fn static_lifetime(&self) {}
}

// explicit named lifetime
impl<'a> dyn Trait + 'a {
    fn explicit_lifetime(&self) {}
}

fn main() {
    let int = 10;
    let foo = Foo { field: &int };

    let trait_object: &dyn Trait = &foo;

    // does not compile: `int` does not live long enough
    // the object behind the trait_object reference is required to be 'static,
    // which is not the case
    // trait_object.implicit_lifetime();

    // does not compile: same reason as above
    // trait_object.static_lifetime();

    // successfully compiles
    trait_object.explicit_lifetime();
}
```

This illustrates that the `'a` is not redundant: it allows trait objects to hold references to non-'static types.

So why did Dtolnay add the `'a` there? While the quiz doesn’t depend on it, the lifetime is technically meaningful: it allows the trait object to hold references that are not `'static`.