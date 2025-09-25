---
title: "Type erasing dyn trait"
pubDate: 2025-09-25
description: "Did you ever want to `Box<dyn Any>` to downcast to `dyn SomeTrait`"
draft: true
---

In a [post about `typed-eval`](2025-09-23-building-typed-eval) I store a `Box<dyn Fn(&A)->R>` in a `Box<dyn Any>`. In the actual crate, I do not do _exactly_ this, but it is very similar.

The goal that I want to achieve is to have type-erased function, which I can downcast back to something callable. The desired interface is something like this:

```rs
struct TypeErasedFn { .. }
impl TypeErasedFn {
    fn new<A, R>(f: impl Fn(A)->R) -> Self { .. }
    fn downcast_ref<A, R>(&self) -> &dyn Fn(A)->R { .. }
}
```

The first thing that comes to mind, when you need something type-erased in Rust is `Box<dyn Any>`.

We definitely can put a function or closure into a `Box<dyn Any>`.

```rs
let boxed_fn: Box<dyn Any> = Box::new(|a: i32| a * 2);
```

But we cannot downcast back to a function or closure type. Because we do not know the type we want to downcast to: every function and closure has an unique unnamed type in Rust. But `downcast_ref` requires us to specify a type we want to downcast to:

```rs
impl dyn Any {
    pub fn downcast_ref<T: Any>(&self) -> Option<&T> { .. }
}
```

As a side note: theoretically, for pure functions, we can use function pointers, as they are named types, and every matching function can be cast to that type. But that is not the case with closures.

We can store a function or a closure in a `Box<dyn Fn>`. For given set of argument and return types there is a type that can store any matching function or closure. `Box<dyn Fn(i32)->i32>` or `Box<dyn Fn()->String>` are examples of such types.

To achieve our goal we can just store `Box<dyn Fn>` inside `Box<dyn Any>`. It works:

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

But that little perfectionist inside of me just keeps asking: can we get rid of the double boxing? Why can't we store a function inside a `Box<dyn Any>` and then downcast it to `Box<dyn Fn>`?

At some point I just surrended and decided to check, why exactly we cannot do that, and what we can do to avoid this double allocation and double indirecton that happens because of the double boxing.

Actually, my question is more general: why can't we convert from `Box<dyn Any>` to `Box<dyn SomeTrait>`? And `Box<dyn Fn>` is just a particular case for this more general question.

Let's start from the beginning. What is `Box`? `Box` is a smart pointer that holds a pointer to heap-allocated data. It allocates the memory when we call `Box::new` and frees it when it is dropped.

What is a pointer in Rust? Turns out it is more than just an address in memory. Some pointers, like pointers to `str`, slices or, what we are interested in, dyn traits, are so called fat pointers. They hold an address in memory and some additional information: for `str` and slices it is the length of data, and for dyn traits it is a pointer to the vtable. Vtable (virtual table, those how ever wrote in C++ know the concept) is a list of functions that implement the trait, stored in uniform manner, so we can call them without knowing just the trait, but not the exact type.

So when we have a pointer to `dyn Trait` we actually have two things: the pointer to data and pointer to the table.

How does `Box<dyn Any>` works? It stores id of the type of the stored data, and when we downcast `Box<dyn Any>` to a concrete type it checks that type ids match and throws away the fat part of the pointer: the pointer to the vtable for the `Any` trait.

If we want to downcast to pointer to `dyn SomeTrait` we need not to just throw away a pointer to vtable for `Any`, but to replace it with pointer to vtable for `SomeTrait`. But `Any` does not store it, so going from pointer to `dyn Any` to pointer to `dyn SomeTrait` is impossible.

But we can do this manually. Only with nightly rust, though. Rust has an API for manipulating fat pointers hidden behind the [`#![feature(ptr_metadata)]`](https://github.com/rust-lang/rust/issues/81513). It has functions to split fat pointer into data pointer and metadata, and to combine it back, namely [to_raw_parts](https://doc.rust-lang.org/std/primitive.pointer.html#method.to_raw_parts) and [`from_raw_parts`](https://doc.rust-lang.org/std/ptr/fn.from_raw_parts.html).

The documentation also states that for `dyn SomeTrait` metadata will have the type `DynMetadata<T>` where `T` is `dyn SomeTrait`. Here is the [documentation link](https://doc.rust-lang.org/std/ptr/trait.Pointee.html#associatedtype.Metadata).

For us this means that for every trait there will be different `DynMetadata<T>` type. The documentation states that `DynMetadata` is a pointer to a vtable. Also, we can see it in the sources:

```rs
pub struct DynMetadata<Dyn: PointeeSized> {
    _vtable_ptr: NonNull<VTable>,
    _phantom: crate::marker::PhantomData<Dyn>,
}
```

So it should be safe to convert it to a pointer `*const ()` and than back to `DynMetadata` if we make sure it is the same type.

Here is the code I end up with:

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

        // SAFETY: We are erasing `DynMetadata<T>` into a raw pointer.
        // This relies on `DynMetadata<T>` being pointer-sized, which
        // holds on current Rust but is not formally guaranteed.
        let metadata: *const () = unsafe { std::mem::transmute(metadata) };
        let type_id = TypeId::of::<T>();

        fn drop_fn<T>(me: &mut TypeErasedBox)
        where
            T: Pointee<Metadata = DynMetadata<T>> + ?Sized + 'static,
        {
            let ptr = me.as_ptr_impl::<T>();

            // SAFETY: Pointer was produced by `Box::into_raw` in `new`
            // and is consumed exactly once here.
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
        let fat: DynMetadata<T> = unsafe { std::mem::transmute(self.metadata) };

        std::ptr::from_raw_parts_mut(self.data_pointer, fat)
    }
}
```

Now, we can just use this `TypeErasedBox` struct to hold `dyn Fn`:

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

I am not going to actually use this in `typed-eval` crate for now, but my inner perfectionist is not bothering me anymore: we actually can do this, even though most probably it is not worth it.

I am not an expert in unsafe Rust, so if you see something wrong about it, please say so, I would really appreciate this.

Thank you for reading.