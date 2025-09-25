---
title: "Type-erasing dyn traits in Rust"
pubDate: 2025-09-25
description: "How to store and recover trait objects without knowing their concrete type in Rust"
draft: false
---

## Introduction

In Rust, `Box<dyn Any>` lets you store any type and recover it later, but what if you don’t want the concrete type? What if you want to go back to a `Box<dyn SomeTrait>` instead?  

In this post, I’ll show how to type-erase `dyn` trait objects - including `dyn Fn` - so that you can store them and call them later.  

A concrete illustration of the problem comes from a [previous post about `typed-eval`](../2025-09-23-building-typed-eval), where I stored a `Box<dyn Fn(&A) -> R>` inside a `Box<dyn Any>`. 

The goal is to have a type-erased function that can be downcast back to something callable. Ideally, the interface would look like this:

```rs
struct TypeErasedFn { .. }
impl TypeErasedFn {
    fn new<A, R>(f: impl Fn(A) -> R) -> Self { .. }
    fn downcast_ref<A, R>(&self) -> &dyn Fn(A) -> R { .. }
}
```

## Why `Box<dyn Any>` Alone Isn’t Enough

The first thing that comes to mind when you need type erasure in Rust is `Box<dyn Any>`.

We can indeed put a function or closure into a `Box<dyn Any>`:

```rs
let boxed_fn: Box<dyn Any> = Box::new(|a: i32| a * 2);
```

However, we cannot downcast it back to a function or closure type, because each closure has a unique, unnamed type in Rust. `downcast_ref` requires knowing the exact type at compile time, which we don’t have here:

```rs
impl dyn Any {
    pub fn downcast_ref<T: Any>(&self) -> Option<&T> { .. }
}
```

As a side note: for pure functions, you could theoretically use function pointers, since they have named types and can be cast to a common type. But this does not work for closures.

## Using `Box<dyn Fn>` Inside `Box<dyn Any>`

We can, however, store a function or closure in a `Box<dyn Fn>` and then put that inside a `Box<dyn Any>`. A `Box<dyn Fn>` is a callable type that can hold any function or closure matching its argument and return types—for example, `Box<dyn Fn(i32) -> i32>` can store any closure or function that takes an `i32` and returns an `i32`.

By storing the `Box<dyn Fn>` inside a `Box<dyn Any>`, we achieve type erasure while still being able to recover a callable reference later. Here’s how it works:

```rs
struct TypeErasedFn(Box<dyn Any>);
impl TypeErasedFn {
    fn new<A: 'static, R: 'static>(f: impl Fn(A) -> R + 'static) -> Self {
        let boxed_fn: Box<dyn Fn(A) -> R> = Box::new(f);
        Self(Box::new(boxed_fn))
    }
    fn downcast_ref<A: 'static, R: 'static>(&self) -> Option<&dyn Fn(A) -> R> {
        let boxed_fn = self.0.downcast_ref::<Box<dyn Fn(A) -> R>>()?;
        Some(boxed_fn.as_ref())
    }
}
```

This approach succeeds, but I was still wondering if we could avoid the double boxing and the extra indirection it introduces. Why can’t we store a function inside a `Box<dyn Any>` and then downcast it directly to `Box<dyn Fn>`?

Eventually, I decided to explore why this isn’t possible and whether we can avoid the double allocation and double indirection caused by double boxing.

## Pointers and Fat Pointers in Rust

More generally: why can’t we convert from `Box<dyn Any>` to `Box<dyn SomeTrait>`? The `Box<dyn Fn>` case is just a specific instance of this broader question.

Let’s start with the basics. What is a `Box`? It’s a smart pointer that owns heap-allocated data. It allocates memory on `Box::new` and frees it when dropped.

What is a pointer in Rust? Turns out it is more than just an address in memory. Some pointers, like pointers to `str`, slices, or, what we are interested in, trait objects, are so-called fat pointers. They store both an address in memory and some additional metadata: for `str` and slices, the length of the data; for `dyn Trait`, a pointer to the vtable. A vtable (virtual table, familiar to those who have used C++) is a table of functions implementing the trait, stored in a uniform manner, which allows us to call trait methods without knowing the concrete type.

Thus, a pointer to `dyn Trait` contains two pieces of information: a data pointer and a vtable pointer.

## Why `Box<dyn Any> --> Box<dyn Trait>` Doesn’t Work

How does `Box<dyn Any>` work? It stores the type ID of the contained data. When downcasting `Box<dyn Any>` to a concrete type, it checks if the type IDs match and discards the fat pointer metadata — the `dyn Any` vtable pointer.

If we want to downcast to a pointer to `dyn SomeTrait`, we don’t just need to discard the `Any` vtable pointer; we need to replace it with the vtable pointer for `SomeTrait`. But `Any` doesn’t store this, so converting from `Box<dyn Any>` to `Box<dyn SomeTrait>` directly is impossible.

## Manipulating Fat Pointers Manually

However, we can do this manually, on nightly Rust. Rust has an API for manipulating fat pointers, hidden behind the [`#![feature(ptr_metadata)]`](https://github.com/rust-lang/rust/issues/81513) feature. It provides functions to split a fat pointer into the data pointer and metadata, and to recombine them, namely [`to_raw_parts`](https://doc.rust-lang.org/std/primitive.pointer.html#method.to_raw_parts) and [`from_raw_parts`](https://doc.rust-lang.org/std/ptr/fn.from_raw_parts.html).

For `dyn SomeTrait`, the metadata type is `DynMetadata<T>` where `T` is `dyn SomeTrait`. Documentation [here](https://doc.rust-lang.org/std/ptr/trait.Pointee.html#associatedtype.Metadata) explains this.

For each trait, there is a different `DynMetadata<T>` type. This matters because we want to store the metadata without referring to the specific type `T`. The documentation states that `DynMetadata<T>` is essentially a pointer to a vtable, and we can confirm this by looking at the source code:

```rs
pub struct DynMetadata<Dyn: PointeeSized> {
    _vtable_ptr: NonNull<VTable>,
    _phantom: crate::marker::PhantomData<Dyn>,
}
```

Thus, it’s safe to convert it to a `*const ()` and back to `DynMetadata` if we ensure the type matches.

## Type-Erased Trait Objects Implementation

Here’s the `TypeErasedBox` implementation I ended up with:

```rs
#![feature(ptr_metadata)]

use std::{
    any::TypeId,
    ptr::{DynMetadata, Pointee},
};

/// A type-erased `Box<dyn Trait>`.
/// Similar to `Box<dyn Any>`, but stores trait objects instead of concrete types.
struct TypeErasedBox {
    data_pointer: *mut (),
    metadata: *const (),
    type_id: TypeId,
    drop_fn: Option<fn(&mut Self)>,
}

impl Drop for TypeErasedBox {
    fn drop(&mut self) {
        if let Some(drop_fn) = self.drop_fn.take() {
            drop_fn(self)
        }
    }
}

impl TypeErasedBox {
    pub fn new<T>(box_dyn: Box<T>) -> Self
    where
        T: Pointee<Metadata = DynMetadata<T>> + ?Sized + 'static,
    {
        let (data_pointer, metadata) = Box::into_raw(box_dyn).to_raw_parts();

        // SAFETY: Erasing `DynMetadata<T>` into `*const ()`.
        // Invariant: `DynMetadata<T>` is represented as a pointer-sized vtable reference
        // on current compilers. We rely on that representation here (nightly-only `ptr_metadata`).
        // This is an implementation detail and not a stable language guarantee.
        let metadata: *const () = unsafe { std::mem::transmute(metadata) };
        let type_id = TypeId::of::<T>();

        fn drop_fn<T>(me: &mut TypeErasedBox)
        where
            T: Pointee<Metadata = DynMetadata<T>> + ?Sized + 'static,
        {
            let ptr = me.as_ptr_impl::<T>();

            // SAFETY: `ptr` was produced by `Box::into_raw` in `new` and is consumed here.
            // We reconstruct the original `Box<T>` exactly once, transferring ownership back to Rust so it is dropped normally.
            let box_dyn = unsafe { Box::from_raw(ptr) };
            drop(box_dyn);
        }

        TypeErasedBox {
            data_pointer,
            metadata,
            type_id,
            drop_fn: Some(drop_fn::<T>),
        }
    }

    pub fn downcast_ref<T>(&self) -> Option<&T>
    where
        T: Pointee<Metadata = DynMetadata<T>> + ?Sized + 'static,
    {
        if self.type_id != TypeId::of::<T>() {
            return None;
        }

        let ptr = self.as_ptr_impl::<T>();

        // SAFETY: The reconstructed pointer refers to the unique `Box`
        // owned by this container, so creating a shared reference is valid.
        Some(unsafe { &*ptr })
    }

    fn as_ptr_impl<T>(&self) -> *mut T
    where
        T: Pointee<Metadata = DynMetadata<T>> + ?Sized + 'static,
    {
        assert_eq!(self.type_id, TypeId::of::<T>());

        // SAFETY: We are reinterpreting the stored erased metadata as `DynMetadata<T>`.
        // Invariant: `metadata` came from `DynMetadata<T>` in `new`, and we only
        // ever call this for the matching `T`.
        let metadata: DynMetadata<T> =
            unsafe { std::mem::transmute(self.metadata) };

        std::ptr::from_raw_parts_mut(self.data_pointer, metadata)
    }
}
```

This struct allows storing any trait object in a type-erased way and recovering it later via `downcast_ref`. Internally, it works by breaking the `Box<dyn Trait>` into its two components: the data pointer and the metadata pointer (which points to the vtable). These are stored in a type-erased form (`*mut ()` for data and `*const ()` for metadata), and the original `Box<dyn Trait>` is reconstructed on demand when `downcast_ref` is called.

## Type-Erased `dyn Fn`

Now, we can use `TypeErasedBox` to hold `dyn Fn`:

```rs
struct DynFn(TypeErasedBox);

impl DynFn {
    fn new<A: 'static, R: 'static>(
        f: impl Fn(A) -> R + Sized + 'static,
    ) -> Self {
        Self(TypeErasedBox::new::<dyn Fn(A) -> R>(Box::new(f)))
    }

    fn downcast_ref<A: 'static, R: 'static>(&self) -> Option<&dyn Fn(A) -> R> {
        self.0.downcast_ref()
    }
}

fn main() {
    let dyn_fn = DynFn::new(|a: i32| a * 2);
    dbg!((dyn_fn.downcast_ref::<i32, i32>().unwrap())(10));
}
```

This demonstrates that we can call the original closure through a type-erased trait object without knowing its concrete type.

## Conclusion

I don’t plan to use this in the `typed-eval` crate for now, but the perfectionist inside me is satisfied: it is actually possible, even though it may not be worth the complexity.

I’m not an expert in unsafe Rust, so if you see anything wrong here, I would greatly appreciate feedback.

Thank you for reading.
