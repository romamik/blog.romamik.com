---
title: "Some Rust tricks I used in typed-eval"
pubDate: 2025-09-25
description: "TODO"
draft: true
---

## Introducing typed-eval

[typed-eval](https://github.com/romamik/typed-eval-rs) is a Rust library I spent too many time working on lately. It started as a proof of concept, but in the end I found myself trying to make it something finished. I on my way to it though.

Basically, it is a expression evaluation engine, implemented in Rust. It takes a string, and returns a function that can be called just like any other Rust function. The main idea behind it is combining closures, like in this example:

```rs
type CompiledFunction = Box<dyn Fn() -> i64>;

fn compile_const(val: i64) -> CompiledFunction {
    Box::new(move || val)
}

fn compile_add(lhs: CompiledFunction, rhs: CompiledFunction) -> CompiledFunction {
    Box::new(move || lhs() + rhs())
}

fn main() {
    let f = compile_add(compile_const(10), compile_const(20));
    assert_eq!(f(), 30);
}
```

This can be used to compile an abstract syntax tree (AST) into a function:

```rs
enum Ast {
    Const(i64),
    Add(Box<Ast>, Box<Ast>),
}

fn compile_ast(ast: Ast) -> CompiledFunction {
    match ast {
        Ast::Const(val) => compile_const(val),
        Ast::Add(lhs, rhs) => compile_add(compile_ast(*lhs), compile_ast(*rhs)),
    }
}

fn main() {
    let f = compile_ast(Ast::Add(Box::new(Ast::Const(10)), Box::new(Ast::Const(20))));
    assert_eq!(f(), 30);
}
```

## Why does it have `typed` in the name

Having such an engine that can only work with one type is not really interesting. There can be different approaches, how can we add different types to such an engine. We want our functions to return different types.

```rs
type CompiledFunction<T> = Box<dyn Fn() -> T>;

fn compile_const<T: Clone + 'static>(val: T) -> CompiledFunction<T> {
    Box::new(move || val.clone())
}

fn compile_add<T: Clone + Add<Output = T> + 'static>(
    lhs: CompiledFunction<T>,
    rhs: CompiledFunction<T>,
) -> CompiledFunction<T> {
    Box::new(move || lhs() + rhs())
}

enum Ast<T> {
    Const(T),
    Add(Box<Ast<T>>, Box<Ast<T>>),
}
```

Stop. This way we may have different types, and this can be useful in some way, but what if we want to mix different types in one expression? For example, we may want to have a constant of type `String` and return it's length?

Can't we just do this:

```rs
enum Ast {
    ConstInt(i64),
    ConstString(String),
    Add(Box<Ast>, Box<Ast>),
    GetLength(Box<Ast>)
}

fn compile_ast(ast: Ast) -> // wait... What do write here?
```

We can't do this, we need some type that does not depend on the type of the expression. One of the options is to define our `CompiledFunction` like this:

```rs
type TypedCompiledFunction<T> = Box<dyn Fn() -> T>;

enum CompiledFunction {
    Int(TypedCompiledFunction<i64>),
    String(TypedCompiledFunction<String>),
}
```

Believe me, it is possible to have it running. If you are curious, expand the code here:

```rs showLineNumbers=false collapse={9-11,15-19,23-27,42-57,62-70,81-85,90-93,97-102} collapseStyle=collapsible-auto
type TypedCompiledFunction<T> = Box<dyn Fn() -> T>;

enum CompiledFunction {
    Int(TypedCompiledFunction<i64>),
    String(TypedCompiledFunction<String>),
}

trait EvalType: Clone + 'static {
    fn new_compiled_function(
        f: impl Fn() -> Self + 'static,
    ) -> CompiledFunction;
}

impl EvalType for i64 {
    fn new_compiled_function(
        f: impl Fn() -> Self + 'static,
    ) -> CompiledFunction {
        CompiledFunction::Int(Box::new(f))
    }
}

impl EvalType for String {
    fn new_compiled_function(
        f: impl Fn() -> Self + 'static,
    ) -> CompiledFunction {
        CompiledFunction::String(Box::new(f))
    }
}

fn compile_const<T: EvalType>(val: T) -> CompiledFunction {
    T::new_compiled_function(move || val.clone())
}

fn compile_add(
    lhs: CompiledFunction,
    rhs: CompiledFunction,
) -> CompiledFunction {
    match (lhs, rhs) {
        (CompiledFunction::Int(lhs), CompiledFunction::Int(rhs)) => {
            i64::new_compiled_function(move || lhs() + rhs())
        }

        (CompiledFunction::Int(lhs), CompiledFunction::String(rhs)) => {
            String::new_compiled_function(move || {
                lhs().to_string() + rhs().as_str()
            })
        }

        (CompiledFunction::String(lhs), CompiledFunction::Int(rhs)) => {
            String::new_compiled_function(move || {
                lhs() + rhs().to_string().as_str()
            })
        }

        (CompiledFunction::String(lhs), CompiledFunction::String(rhs)) => {
            String::new_compiled_function(move || lhs() + rhs().as_str())
        }
    }
}

fn compile_get_length(s: Ast) -> CompiledFunction {
    let compiled_s = compile_ast(s);
    match compiled_s {
        CompiledFunction::Int(_) => {
            panic!("get_length not defined for Int")
        }
        CompiledFunction::String(f) => {
            i64::new_compiled_function(move || f().len() as i64)
        }
    }
}

enum Ast {
    ConstInt(i64),
    ConstString(String),
    Add(Box<Ast>, Box<Ast>),
    GetLength(Box<Ast>),
}

fn compile_ast(ast: Ast) -> CompiledFunction {
    match ast {
        Ast::ConstInt(val) => compile_const(val),
        Ast::ConstString(s) => compile_const(s),
        Ast::Add(lhs, rhs) => compile_add(compile_ast(*lhs), compile_ast(*rhs)),
        Ast::GetLength(s) => compile_get_length(*s),
    }
}

fn cast_to_int(f: CompiledFunction) -> impl Fn() -> i64 {
    match f {
        CompiledFunction::Int(f) => f,
        _ => panic!("Expected function returning int"),
    }
}

fn main() {
    let f = cast_to_int(compile_ast(Ast::Add(
        Box::new(Ast::ConstInt(10)),
        Box::new(Ast::ConstInt(20)),
    )));
    assert_eq!(f(), 30);

    let f = cast_to_int(compile_ast(Ast::GetLength(Box::new(
        Ast::ConstString("Hello, world".into()),
    ))));
    assert_eq!(f(), 12);
}
```

If you were curious and observed the code, you can imagine that expanding such system would be a nightmare. Every supported type would require adding a enum variant and then matching it in every relevant section.

Yes, we can do some tricks with the code above to make it better. But I think we need something different. What about storing our compiled function in `Box<dyn Any>`? `TypedCompiledFunction<T>` is a concrete type that we can put in and take from `Box<Any>`, so nothing crazy about it. Our function will be double-boxed, but why not? We can store `type_id` along the function to know the returned type.

```rs showLineNumbers=false collapse={1-2,12-17,20-22,33-54,57-63,73-79,82-88} collapseStyle=collapsible-auto
use std::any::{Any, TypeId};

type TypedCompiledFunction<T> = Box<dyn Fn() -> T>;

struct CompiledFunction {
    f: Box<dyn Any>, // stores TypedCompiledFunction<T>
    ty: TypeId,      // stores TypeId::of::<T>()
}

impl CompiledFunction {
    fn new<T: 'static>(f: impl Fn() -> T + 'static) -> Self {
        let typed_fn: TypedCompiledFunction<T> = Box::new(f);
        Self {
            f: Box::new(typed_fn),
            ty: TypeId::of::<T>(),
        }
    }

    fn downcast<T: 'static>(self) -> impl Fn() -> T {
        assert_eq!(self.ty, TypeId::of::<T>());
        self.f.downcast::<TypedCompiledFunction<T>>().unwrap()
    }
}

fn compile_const<T: Clone + 'static>(val: T) -> CompiledFunction {
    CompiledFunction::new(move || val.clone())
}

fn compile_add(
    lhs: CompiledFunction,
    rhs: CompiledFunction,
) -> CompiledFunction {
    let i64_ty = TypeId::of::<i64>();
    let str_ty = TypeId::of::<String>();
    if lhs.ty == i64_ty && rhs.ty == i64_ty {
        let lhs = lhs.downcast::<i64>();
        let rhs = rhs.downcast::<i64>();
        CompiledFunction::new(move || lhs() + rhs())
    } else if lhs.ty == i64_ty && rhs.ty == str_ty {
        let lhs = lhs.downcast::<i64>();
        let rhs = rhs.downcast::<String>();
        CompiledFunction::new(move || format!("{}{}", lhs(), rhs()))
    } else if lhs.ty == str_ty && rhs.ty == i64_ty {
        let lhs = lhs.downcast::<String>();
        let rhs = rhs.downcast::<i64>();
        CompiledFunction::new(move || format!("{}{}", lhs(), rhs()))
    } else if lhs.ty == str_ty && rhs.ty == str_ty {
        let lhs = lhs.downcast::<String>();
        let rhs = rhs.downcast::<String>();
        CompiledFunction::new(move || format!("{}{}", lhs(), rhs()))
    } else {
        panic!("Unsupported add")
    }
}

fn compile_get_length(s: Ast) -> CompiledFunction {
    let compiled_s = compile_ast(s);
    if compiled_s.ty != TypeId::of::<String>() {
        panic!("get_length not defined for types other than String");
    }
    let compiled_s = compiled_s.downcast::<String>();
    CompiledFunction::new(move || compiled_s().len() as i64)
}

enum Ast {
    ConstInt(i64),
    ConstString(String),
    Add(Box<Ast>, Box<Ast>),
    GetLength(Box<Ast>),
}

fn compile_ast(ast: Ast) -> CompiledFunction {
    match ast {
        Ast::ConstInt(val) => compile_const(val),
        Ast::ConstString(s) => compile_const(s),
        Ast::Add(lhs, rhs) => compile_add(compile_ast(*lhs), compile_ast(*rhs)),
        Ast::GetLength(s) => compile_get_length(*s),
    }
}

fn main() {
    let f = compile_ast(Ast::Add(
        Box::new(Ast::ConstInt(10)),
        Box::new(Ast::ConstInt(20)),
    ))
    .downcast::<i64>();
    assert_eq!(f(), 30);

    let f = compile_ast(Ast::GetLength(Box::new(Ast::ConstString(
        "Hello, world".into(),
    ))))
    .downcast::<i64>();
    assert_eq!(f(), 12);
}
```

I think it is worth it to compare the above code to the previous example. We saved ourselves a lot of work if would want to add more types in the future.

But look at the `compile_add` functions:

```rs
fn compile_add(
    lhs: CompiledFunction,
    rhs: CompiledFunction,
) -> CompiledFunction {
    let i64_ty = TypeId::of::<i64>();
    let str_ty = TypeId::of::<String>();
    if lhs.ty == i64_ty && rhs.ty == i64_ty {
        let lhs = lhs.downcast::<i64>();
        let rhs = rhs.downcast::<i64>();
        CompiledFunction::new(move || lhs() + rhs())
    } else if lhs.ty == i64_ty && rhs.ty == str_ty {
        let lhs = lhs.downcast::<i64>();
        let rhs = rhs.downcast::<String>();
        CompiledFunction::new(move || format!("{}{}", lhs(), rhs()))
    } else if lhs.ty == str_ty && rhs.ty == i64_ty {
        let lhs = lhs.downcast::<String>();
        let rhs = rhs.downcast::<i64>();
        CompiledFunction::new(move || format!("{}{}", lhs(), rhs()))
    } else if lhs.ty == str_ty && rhs.ty == str_ty {
        let lhs = lhs.downcast::<String>();
        let rhs = rhs.downcast::<String>();
        CompiledFunction::new(move || format!("{}{}", lhs(), rhs()))
    } else {
        panic!("Unsupported add")
    }
}
```

Not only we will need to support every type here, but also it will grow exponentially if would want to support addition between different types. Consider adding `i32`, that can be added we `i64` and also with `String`, we will need to add if blocks for every combination.

Instead, we can define addition for types we want to support, and also cast operations between the types. For casts we would only want to support casts in one direction: `i32` to `i64`, or `i32` to `String`, but not the other way around. This way addition can work like this:

- If arguments have the same type check if this types supports addition
- If arguments are of different types check if we cast one to another to make them same type

With this in place, we will have linear amount of work when supporting new type: just add operations for that type and it's casts.

```rs showLineNumbers=false collapse={1-5,9-26,29-33,37-43,47-69,93-100,107-114,135-141,144-152,156-171} collapseStyle=collapsible-auto
use std::{
    any::{Any, TypeId},
    collections::HashMap,
};

type TypedCompiledFunction<T> = Box<dyn Fn() -> T>;

struct CompiledFunction {
    f: Box<dyn Any>, // stores TypedCompiledFunction<T>
    ty: TypeId,      // stores TypeId::of::<T>()
}

impl CompiledFunction {
    fn new<T: 'static>(f: impl Fn() -> T + 'static) -> Self {
        let typed_fn: TypedCompiledFunction<T> = Box::new(f);
        Self {
            f: Box::new(typed_fn),
            ty: TypeId::of::<T>(),
        }
    }

    fn downcast<T: 'static>(self) -> impl Fn() -> T {
        assert_eq!(self.ty, TypeId::of::<T>());
        self.f.downcast::<TypedCompiledFunction<T>>().unwrap()
    }
}

enum Ast {
    ConstInt(i64),
    ConstString(String),
    Add(Box<Ast>, Box<Ast>),
    GetLength(Box<Ast>),
}

#[derive(Default)]
struct Compiler {
    add: HashMap<
        TypeId,
        fn(CompiledFunction, CompiledFunction) -> CompiledFunction,
    >,

    cast: HashMap<(TypeId, TypeId), fn(CompiledFunction) -> CompiledFunction>,
}

impl Compiler {
    fn new() -> Self {
        let add_int: fn(
            CompiledFunction,
            CompiledFunction,
        ) -> CompiledFunction = |lhs, rhs| {
            let lhs = lhs.downcast::<i64>();
            let rhs = rhs.downcast::<i64>();
            CompiledFunction::new(move || lhs() + rhs())
        };

        let add_string: fn(
            CompiledFunction,
            CompiledFunction,
        ) -> CompiledFunction = |lhs, rhs| {
            let lhs = lhs.downcast::<String>();
            let rhs = rhs.downcast::<String>();
            CompiledFunction::new(move || lhs() + &rhs())
        };

        let cast_int_string: fn(CompiledFunction) -> CompiledFunction = |f| {
            let f = f.downcast::<i64>();
            CompiledFunction::new(move || f().to_string())
        };

        Compiler {
            add: [
                (TypeId::of::<i64>(), add_int),
                (TypeId::of::<String>(), add_string),
            ]
            .into(),
            cast: [(
                (TypeId::of::<i64>(), TypeId::of::<String>()),
                cast_int_string,
            )]
            .into(),
        }
    }

    fn compile_const<T: Clone + 'static>(&self, val: T) -> CompiledFunction {
        CompiledFunction::new(move || val.clone())
    }

    fn try_cast(
        &self,
        f: CompiledFunction,
        ty: TypeId,
    ) -> Result<CompiledFunction, CompiledFunction> {
        if f.ty == ty {
            Ok(f)
        } else if let Some(cast_fn) = self.cast.get(&(f.ty, ty)) {
            Ok(cast_fn(f))
        } else {
            Err(f)
        }
    }

    fn make_same_type(
        &self,
        a: CompiledFunction,
        b: CompiledFunction,
    ) -> Option<(CompiledFunction, CompiledFunction)> {
        match self.try_cast(b, a.ty) {
            Ok(casted_b) => Some((a, casted_b)),
            Err(b) => match self.try_cast(a, b.ty) {
                Ok(casted_a) => Some((casted_a, b)),
                Err(_) => None,
            },
        }
    }

    fn compile_add(
        &self,
        lhs: CompiledFunction,
        rhs: CompiledFunction,
    ) -> CompiledFunction {
        let Some((lhs, rhs)) = self.make_same_type(lhs, rhs) else {
            panic!("Uncompatible types for addition");
        };

        assert_eq!(lhs.ty, rhs.ty);

        let Some(add_fn) = self.add.get(&lhs.ty) else {
            panic!("Type does not support addition")
        };

        add_fn(lhs, rhs)
    }

    fn compile_get_length(&self, s: Ast) -> CompiledFunction {
        let compiled_s = self.compile_ast(s);
        if compiled_s.ty != TypeId::of::<String>() {
            panic!("get_length not defined for types other than String");
        }
        let compiled_s = compiled_s.downcast::<String>();
        CompiledFunction::new(move || compiled_s().len() as i64)
    }

    fn compile_ast(&self, ast: Ast) -> CompiledFunction {
        match ast {
            Ast::ConstInt(val) => self.compile_const(val),
            Ast::ConstString(s) => self.compile_const(s),
            Ast::Add(lhs, rhs) => {
                self.compile_add(self.compile_ast(*lhs), self.compile_ast(*rhs))
            }
            Ast::GetLength(s) => self.compile_get_length(*s),
        }
    }
}

fn main() {
    let compiler = Compiler::new();
    let f = compiler
        .compile_ast(Ast::Add(
            Box::new(Ast::ConstInt(10)),
            Box::new(Ast::ConstInt(20)),
        ))
        .downcast::<i64>();
    assert_eq!(f(), 30);

    let f = compiler
        .compile_ast(Ast::GetLength(Box::new(Ast::ConstString(
            "Hello, world".into(),
        ))))
        .downcast::<i64>();
    assert_eq!(f(), 12);
}
```

You may notice that our expressions are not really useful: they always return some constant value. It will make sense to allow these expressions to access some context:

```rs
type TypedCompiledFunction<Ctx, T> = Box<dyn Fn(&Ctx) -> T>;
```

How can we use it in the compiler? We can define a trait that allows us to access fields of context. But not like this:

```rs
trait EvalContext {
    fn get_field(&self, name: &str) -> // fields have different types...
}
```

It would be possible for our compiler to leverage this, but much better would be to return a getter function instead of field value:

```rs
trait EvalContext {
    // returns a function Ctx->FieldType
    fn field_getter(name: &str) -> Option<CompiledFunction>;
}
```

Let's implement it for some type:

```rs
struct Context {
    int: i64,
    string: String,
}

impl EvalContext for Context {
    fn field_getter(name: &str) -> Option<CompiledFunction> {
        match name {
            "int" => Some(CompiledFunction::new(move |ctx: &Context| ctx.int)),
            "string" => Some(CompiledFunction::new(move |ctx: &Context| {
                ctx.string.clone()
            })),
            _ => None,
        }
    }
}
```

To use it in the compiler, we first need to add a new variant to the `Ast` enum, let's call it `ContextField`:

```rs
enum Ast {
    ConstInt(i64),
    ConstString(String),
    ContextField(String),
    Add(Box<Ast>, Box<Ast>),
    GetLength(Box<Ast>),
}
```

And finally, after some work, we can have our expressions access context and be a little more useful:

```rs showLineNumbers=true collapse={1-5,10-27,42-50,54-91,94-95,111-118,125-132,139-150,153-159,162-171,175-177,180-189} collapseStyle=collapsible-auto
use std::{
    any::{Any, TypeId},
    collections::HashMap,
    marker::PhantomData,
};

type TypedCompiledFunction<Ctx, T> = Box<dyn Fn(&Ctx) -> T>;

struct CompiledFunction {
    f: Box<dyn Any>, // stores TypedCompiledFunction<T>
    ty: TypeId,      // stores TypeId::of::<T>()
}

impl CompiledFunction {
    fn new<Ctx: 'static, T: 'static>(f: impl Fn(&Ctx) -> T + 'static) -> Self {
        let typed_fn: TypedCompiledFunction<Ctx, T> = Box::new(f);
        Self {
            f: Box::new(typed_fn),
            ty: TypeId::of::<T>(),
        }
    }

    fn downcast<Ctx: 'static, T: 'static>(self) -> impl Fn(&Ctx) -> T {
        assert_eq!(self.ty, TypeId::of::<T>());
        self.f.downcast::<TypedCompiledFunction<Ctx, T>>().unwrap()
    }
}

enum Ast {
    ConstInt(i64),
    ConstString(String),
    ContextField(String),
    Add(Box<Ast>, Box<Ast>),
    GetLength(Box<Ast>),
}

trait EvalContext: 'static {
    fn field_getter(name: &str) -> Option<CompiledFunction>;
}

struct Compiler<Ctx> {
    add: HashMap<
        TypeId,
        fn(CompiledFunction, CompiledFunction) -> CompiledFunction,
    >,

    cast: HashMap<(TypeId, TypeId), fn(CompiledFunction) -> CompiledFunction>,

    ctx_ty: PhantomData<Ctx>,
}

impl<Ctx: EvalContext> Compiler<Ctx> {
    fn new() -> Self {
        let add_int: fn(
            CompiledFunction,
            CompiledFunction,
        ) -> CompiledFunction = |lhs, rhs| {
            let lhs = lhs.downcast::<Ctx, i64>();
            let rhs = rhs.downcast::<Ctx, i64>();
            CompiledFunction::new(move |ctx| lhs(ctx) + rhs(ctx))
        };

        let add_string: fn(
            CompiledFunction,
            CompiledFunction,
        ) -> CompiledFunction = |lhs, rhs| {
            let lhs = lhs.downcast::<Ctx, String>();
            let rhs = rhs.downcast::<Ctx, String>();
            CompiledFunction::new(move |ctx| lhs(ctx) + &rhs(ctx))
        };

        let cast_int_string: fn(CompiledFunction) -> CompiledFunction = |f| {
            let f = f.downcast::<Ctx, i64>();
            CompiledFunction::new(move |ctx| f(ctx).to_string())
        };

        Self {
            add: [
                (TypeId::of::<i64>(), add_int),
                (TypeId::of::<String>(), add_string),
            ]
            .into(),
            cast: [(
                (TypeId::of::<i64>(), TypeId::of::<String>()),
                cast_int_string,
            )]
            .into(),

            ctx_ty: PhantomData,
        }
    }

    fn compile_const<T: Clone + 'static>(&self, val: T) -> CompiledFunction {
        CompiledFunction::new(move |_: &Ctx| val.clone())
    }

    fn compile_context_field(&self, name: String) -> CompiledFunction {
        let Some(getter) = Ctx::field_getter(name.as_str()) else {
            panic!("no such field");
        };
        // getter is a function that takes Ctx and returns context field value
        // it is exactly what we need here
        getter
    }

    fn try_cast(
        &self,
        f: CompiledFunction,
        ty: TypeId,
    ) -> Result<CompiledFunction, CompiledFunction> {
        if f.ty == ty {
            Ok(f)
        } else if let Some(cast_fn) = self.cast.get(&(f.ty, ty)) {
            Ok(cast_fn(f))
        } else {
            Err(f)
        }
    }

    fn make_same_type(
        &self,
        a: CompiledFunction,
        b: CompiledFunction,
    ) -> Option<(CompiledFunction, CompiledFunction)> {
        match self.try_cast(b, a.ty) {
            Ok(casted_b) => Some((a, casted_b)),
            Err(b) => match self.try_cast(a, b.ty) {
                Ok(casted_a) => Some((casted_a, b)),
                Err(_) => None,
            },
        }
    }

    fn compile_add(
        &self,
        lhs: CompiledFunction,
        rhs: CompiledFunction,
    ) -> CompiledFunction {
        let Some((lhs, rhs)) = self.make_same_type(lhs, rhs) else {
            panic!("Uncompatible types for addition");
        };

        assert_eq!(lhs.ty, rhs.ty);

        let Some(add_fn) = self.add.get(&lhs.ty) else {
            panic!("Type does not support addition")
        };

        add_fn(lhs, rhs)
    }

    fn compile_get_length(&self, s: Ast) -> CompiledFunction {
        let compiled_s = self.compile_ast(s);
        if compiled_s.ty != TypeId::of::<String>() {
            panic!("get_length not defined for types other than String");
        }
        let compiled_s = compiled_s.downcast::<Ctx, String>();
        CompiledFunction::new(move |ctx| compiled_s(ctx).len() as i64)
    }

    fn compile_ast(&self, ast: Ast) -> CompiledFunction {
        match ast {
            Ast::ConstInt(val) => self.compile_const(val),
            Ast::ConstString(s) => self.compile_const(s),
            Ast::ContextField(name) => self.compile_context_field(name),
            Ast::Add(lhs, rhs) => {
                self.compile_add(self.compile_ast(*lhs), self.compile_ast(*rhs))
            }
            Ast::GetLength(s) => self.compile_get_length(*s),
        }
    }
}

struct Context {
    int: i64,
    string: String,
}

impl EvalContext for Context {
    fn field_getter(name: &str) -> Option<CompiledFunction> {
        match name {
            "int" => Some(CompiledFunction::new(move |ctx: &Context| ctx.int)),
            "string" => Some(CompiledFunction::new(move |ctx: &Context| {
                ctx.string.clone()
            })),
            _ => None,
        }
    }
}

fn main() {
    let ctx = Context {
        int: 10,
        string: "Hello, world".into(),
    };

    let compiler = Compiler::<Context>::new();

    let f = compiler
        .compile_ast(Ast::Add(
            Box::new(Ast::ContextField("int".into())),
            Box::new(Ast::ConstInt(20)),
        ))
        .downcast::<Context, i64>();
    assert_eq!(f(&ctx), 30);

    let f = compiler
        .compile_ast(Ast::GetLength(Box::new(Ast::ContextField(
            "string".into(),
        ))))
        .downcast::<Context, i64>();

    assert_eq!(f(&ctx), 12);
}
```

I think this can be the end for this post. It demonstrated some of the ideas behind the `typed-eval` crate, but obviously the actual code is is more complicated but in return has more features.
