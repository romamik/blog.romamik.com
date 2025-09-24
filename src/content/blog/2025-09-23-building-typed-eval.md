---
title: "Building typed-eval: Typed Expressions in Rust"
pubDate: 2025-09-23
description: "Learn how typed-eval compiles typed, context-aware expressions in Rust, and the approaches that make it flexible and extensible."
draft: false
---

I have been working on a Rust crate called [**typed-eval**](https://github.com/romamik/typed-eval-rs). It is not finished yet, but the main ideas are already clear enough to share.

**typed-eval** is an expression evaluation engine with two main features:

- Compiled expressions – every expression is compiled into a Rust function (closure), so evaluating it is as fast as calling a function.
- Typed results – each expression has a known type after compilation, and the compiler can cast the result to a different type if needed.

In this post, I will show how typed-eval works internally, step by step, starting from a very simple version and gradually extending it with types, casting, and context.

## Starting Simple: Expressions as Closures

The core idea of `typed-eval` is that every expression is compiled into a Rust function.  
We can achieve this by combining closures. Here is a minimal example:

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

This shows how we can build functions that represent expressions. For something more structured, we can introduce an _abstract syntax tree (AST)_.
Parsers usually produce an AST from source code, and we can then compile it into a function:

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

## Extending Beyond a Single Type

The engine above only works with one type (`i64`). That is not very interesting.  
We want to extend it so that expressions can return different types.

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

This allows expressions of different types, which is useful. But what if we want to **mix types in the same expression**?  
For example, what if we have a constant of type `String` and want to return its length?

## First Attempt at Mixing Types: Enums

So far, our engine can only handle one type at a time. What if we try to extend the AST with multiple types directly?

```rs
enum Ast {
    ConstInt(i64),
    ConstString(String),
    Add(Box<Ast>, Box<Ast>),
    GetLength(Box<Ast>)
}

fn compile_ast(ast: Ast) -> // wait... What do write here?
```

At this point we hit a problem: the type of the compiled function depends on the type of the expression.  
We need some common representation that works regardless of the return type.

One option is to define a `CompiledFunction` enum that wraps functions of different return types:

```rs
type TypedCompiledFunction<T> = Box<dyn Fn() -> T>;

enum CompiledFunction {
    Int(TypedCompiledFunction<i64>),
    String(TypedCompiledFunction<String>),
}
```

This makes it possible to write a working evaluator.  
The full code below shows how constants, addition, and `get_length` can be implemented using this approach:

```rs
// compile_const now uses apropriate variant
fn compile_const<T: EvalType>(val: T) -> CompiledFunction {
    T::new_compiled_function(move || val.clone())
}

// compile_add handles all type combinations
fn compile_add(
    lhs: CompiledFunction,
    rhs: CompiledFunction,
) -> CompiledFunction {
    match (lhs, rhs) {
        (CompiledFunction::Int(lhs), CompiledFunction::Int(rhs)) => i64::new_compiled_function(move || lhs() + rhs())
        (CompiledFunction::Int(lhs), CompiledFunction::String(rhs)) => String::new_compiled_function(move || lhs().to_string() + rhs().as_str())
        (CompiledFunction::String(lhs), CompiledFunction::Int(rhs)) => String::new_compiled_function(move || lhs() + rhs().to_string().as_str())
        (CompiledFunction::String(lhs), CompiledFunction::String(rhs)) => String::new_compiled_function(move || lhs() + rhs().as_str())
    }
}

// compile_get_length only works for strings
fn compile_get_length(s: Ast) -> CompiledFunction { ... }
```

<details>
<summary><b>Full source code for reference</b></summary>

```rs
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

</details>

This version works, but it has a clear drawback: every time we add a new type, the `CompiledFunction` enum grows, and every operation (`add`, `get_length`, …) needs to handle all type combinations explicitly. The number of cases increases quickly.

## A More Extensible Approach: `Box<dyn Any>`

The enum-based approach works, but storing multiple types directly in an enum is not very flexible.  
A cleaner solution is to store compiled functions in a type-erased box, using `Box<dyn Any>`.

I believe most readers know `Box<dyn Any>`, but just in case: it is a type that allows storing a value of any type, 
and then downcasting back to that type. 

`TypedCompiledFunction<T>` is a concrete type that can be stored in a `Box<dyn Any>` and later downcasted.  
We also store the `TypeId` of the return type, so we can safely downcast and call the function.

Yes, the function will be double-boxed, but this design keeps the system flexible and ready for extension.

```rs
// TypedCompiledFunction is type-specific
type TypedCompiledFunction<T> = Box<dyn Fn() -> T>;

// CompiledFunction can store any type
struct CompiledFunction {
    f: Box<dyn Any>, // stores TypedCompiledFunction<T>
    ty: TypeId,      // stores TypeId::of::<T>()
}

impl CompiledFunction {
    // Create CompiledFunction from a closure
    fn new<T: 'static>(f: impl Fn() -> T + 'static) -> Self {
        let typed_fn: TypedCompiledFunction<T> = Box::new(f);
        Self {
            f: Box::new(typed_fn),
            ty: TypeId::of::<T>(),
        }
    }

    // Downcast back to a typed closure; panics if type mismatches
    fn downcast<T: 'static>(self) -> impl Fn() -> T {
        assert_eq!(self.ty, TypeId::of::<T>());
        self.f.downcast::<TypedCompiledFunction<T>>().unwrap()
    }
}

// compile_const looks almost the same
fn compile_const<T: Clone + 'static>(val: T) -> CompiledFunction {
    CompiledFunction::new(move || val.clone())
}

// compile_add still handles all type combinations
// but now it uses TypeId instead of enum variants
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

<details>
<summary><b>Full source code for reference</b></summary>

```rs
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

</details>

Compared to the enum-based approach, the main advantage of using `Box<dyn Any>` is extensibility: we can add support for new types without changing existing code in multiple places.

## Operations and casting

Using `Box<dyn Any>` makes it easy to add new types, but the `compile_add` function in the previous example still grows exponentially as we support more types:

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

For every new type, we would need to add `if` blocks for every combination of argument types.  
For example, adding `i32` support would require handling combinations with `i64` and `String`, and the number of cases grows very quickly.

A more scalable solution is to register operations and type casts separately:

- Define addition only for types that support it.
- Define cast functions to convert between compatible types.
- When adding two expressions:
  - If the arguments have the same type, use the registered addition function.
  - If they have different types, try casting one to match the other.

With this system, adding a new type is linear: we only need to register its addition function and relevant casts.

Here’s a working implementation:

```rs
// Instead of manually matching all type combinations, register operations and casts
struct Compiler {
    add: HashMap<TypeId, fn(CompiledFunction, CompiledFunction) -> CompiledFunction>,
    cast: HashMap<(TypeId, TypeId), fn(CompiledFunction) -> CompiledFunction>,
}

impl Compiler {
    // Try to cast one CompiledFunction to another type
    fn try_cast(&self, f: CompiledFunction, ty: TypeId) -> Result<CompiledFunction, CompiledFunction>

    // Make two CompiledFunctions have the same type (using registered casts)
    // Try to cast b to a's type; if that fails, try casting a to b's type.
    // If neither works, return None. This ensures both operands have the same type
    // before performing an operation like addition.
    fn make_same_type(&self, a: CompiledFunction, b: CompiledFunction) -> Option<(CompiledFunction, CompiledFunction)>

    // compile_add now uses registered addition functions
    fn compile_add(
        &self,
        lhs: CompiledFunction,
        rhs: CompiledFunction,
    ) -> CompiledFunction {
        let Some((lhs, rhs)) = self.make_same_type(lhs, rhs) else {
            panic!("Incompatible types for addition");
        };
        let Some(add_fn) = self.add.get(&lhs.ty) else {
            panic!("Type does not support addition")
        };
        add_fn(lhs, rhs)
    }
}
```

<details>
<summary><b>Full source code for reference</b></summary>

```rs
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

struct Compiler {
    add: HashMap<TypeId, fn(CompiledFunction, CompiledFunction) -> CompiledFunction>,
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

    // Try to cast b to a's type; if that fails, try casting a to b's type.
    // If neither works, return None. This ensures both operands have the same type
    // before performing an operation like addition.
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
            panic!("Incompatible types for addition");
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

</details>

Now `Compiler` can handle addition and casting in a flexible way:

- `add` holds the registered addition functions per type.
- `cast` holds the registered type conversions.
- `make_same_type` tries to cast one argument to the type of the other.
- `compile_add` uses these mechanisms instead of manually matching each combination.

## Adding context

So far, our expressions always return constant values. That’s useful for examples, but not very interesting in practice.
We often want expressions that can depend on some external state - let's call it a context - so they can produce different
results depending on the situation.

We can achieve this by allowing our compiled functions to take a context as an argument:

```rs
type TypedCompiledFunction<Ctx, T> = Box<dyn Fn(&Ctx) -> T>;
```

How can we use context in the compiler? One idea is to define a trait that allows us to access fields of the context. But we can’t quite do it like this:

```rs
trait EvalContext {
    fn get_field(&self, name: &str) -> // fields have different types...
}
```

Fortunately, there’s a better approach: instead of returning the field value directly, return a getter function that produces the value. This way, the compiler can use it seamlessly in expressions:

```rs
trait EvalContext {
    // returns a function Ctx->FieldType
    fn field_getter(name: &str) -> Option<CompiledFunction>;
}

// Example implementation for a simple context
struct Context {
    int: i64,
    string: String,
}

impl EvalContext for Context {
    fn field_getter(name: &str) -> Option<CompiledFunction> {
        match name {
            "int" => Some(CompiledFunction::new(move |ctx: &Context| ctx.int)),
            "string" => Some(CompiledFunction::new(move |ctx: &Context| ctx.string.clone())),
            _ => None,
        }
    }
}
```

For the compiler to use context, our AST needs to represent context access. We add a `ContextField` variant,
so expressions can read fields from the context just like any other value:

- `ConstInt` and `ConstString` produce constant values.
- `ContextField` produces values from the context.
- `Add` and `GetLength` behave as before, but can now operate on context-dependent values.

```rs
enum Ast {
    ConstInt(i64),
    ConstString(String),
    ContextField(String),
    Add(Box<Ast>, Box<Ast>),
    GetLength(Box<Ast>),
}
```

With the `ContextField` AST variant and context-aware compiled functions in place, our compiler can now generate expressions that read from the context and combine those values just like any other constants.

Putting it all together, here is a working implementation of the compiler that supports context-aware expressions:

```rs
// TypeCompiledFunction now takes a context
type TypedCompiledFunction<Ctx, T> = Box<dyn Fn(&Ctx) -> T>;

// AST has a variant for context access
enum Ast {
    ConstInt(i64),
    ConstString(String),
    ContextField(String), // <--- new
    Add(Box<Ast>, Box<Ast>),
    GetLength(Box<Ast>),
}

// Trait to get fields from context
trait EvalContext: 'static {
    fn field_getter(name: &str) -> Option<CompiledFunction>;
}

// Compiler has become generic over context
struct Compiler<Ctx> {
    add: HashMap<TypeId, fn(CompiledFunction, CompiledFunction) -> CompiledFunction>,
    cast: HashMap<(TypeId, TypeId), fn(CompiledFunction) -> CompiledFunction>,
    ctx_ty: PhantomData<Ctx>, 
}

impl<Ctx: EvalContext> Compiler<Ctx> {
    // New function to compile context access
    fn compile_context_field(&self, name: String) -> CompiledFunction {
        let Some(getter) = Ctx::field_getter(name.as_str()) else {
            panic!("no such field");
        };
        // getter is a function that takes Ctx and returns context field value
        // it is exactly what we need here
        getter
    }

    // compile_ast handles new AST variant
    fn compile_ast(&self, ast: Ast) -> CompiledFunction {
        match ast {
            Ast::ConstInt(val) => self.compile_const(val),
            Ast::ConstString(s) => self.compile_const(s),
            Ast::ContextField(name) => self.compile_context_field(name), // <--- new
            Ast::Add(lhs, rhs) => self.compile_add(self.compile_ast(*lhs), self.compile_ast(*rhs)),
            Ast::GetLength(s) => self.compile_get_length(*s),
        }
    }
}

// Example context
struct Context { int: i64, string: String }

impl EvalContext for Context { ... }

// Usage example
let compiler = Compiler::<Context>::new();

let f = compiler
    .compile_ast(Ast::Add(
        Box::new(Ast::ContextField("int".into())),
        Box::new(Ast::ConstInt(20)),
    ))
    .downcast::<Context, i64>();

let ctx = Context { int: 10, string: "Hello, world".into() };
assert_eq!(f(&ctx), 30);
```

<details>
<summary><b>Full source code for reference</b></summary>

```rs
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
    add: HashMap<TypeId, fn(CompiledFunction, CompiledFunction) -> CompiledFunction>,

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

</details>

With this change, our expressions become much more flexible. They can now combine constants with values from the context,
allowing dynamic computations at runtime.
This approach keeps the type system safe while still letting the compiler generate efficient functions.

## Final words

With this design, we’ve gone from simple constant expressions to a flexible, context-aware compiler. Expressions are compiled into Rust functions, remain strongly typed, and can access arbitrary context values. The system is also extensible: adding new types, operations, or casts requires minimal changes, making it easy to grow as your needs evolve.

The code above was created for demonstration purposes only and omits many features. The actual [**typed-eval**](https://github.com/romamik/typed-eval-rs) crate includes features such as returning references, a Derive macro for context types, or support for objects and methods. But at its core, it is fully based on the concepts we’ve explored in this post.

A few additional points worth noting:

- Performance: Since expressions are compiled into Rust closures, evaluation is fast. Type-erasure and dynamic dispatch via Box<dyn Any> only happen during compilation, not during execution.
- Extensibility: Adding new operations (like multiplication or division) or new types (like Vec<T>) is straightforward and doesn’t require touching the core compiler logic.
- Type safety: Despite using dyn Any, the system still checks types. Even though we did not implement full error reporting for conciseness, the compiler is capable of generating proper type errors instead of panics.

Thank you for reading. I hope you enjoyed the journey through Rust's type system, closures, and a brief exercise in building a typed, extensible expression compiler.
