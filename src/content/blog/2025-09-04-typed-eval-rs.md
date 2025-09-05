---
title: "Typed expression evaluation in Rust"
pubDate: 2025-08-30
description: "Let's build an expression evaluation engine in Rust."
draft: true
---

## What we are building and why

TODO!

## Project setup

I will not go into details of setting up a new project in Rust. For this project, I created a multi-crate workspace with one lib crate called `typed-eval`. Later, we will add one more crate for macros. All the code is in this GitHub repository: [typed-eval-rs](https://github.com/romamik/typed-eval-rs). Also, I will create tags and link them in the text to show the intermediate stages in full.

## Parser and AST

For this blog, we'll skip the parser part and assume we already have a working one. The parser's job is to take a string like `"(1 + 2) * 3"` and turn it into Abstract Syntax Tree (AST). Here are the Rust types that represents the AST for our project:

```rs
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Int(i64),
    Float(f64),
    String(String),
    Var(String),
    UnOp(UnOp, Box<Expr>),
    BinOp(BinOp, Box<Expr>, Box<Expr>),
    FieldAccess(Box<Expr>, String),
    FuncCall(Box<Expr>, Vec<Expr>),
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Mul,
    Sub,
    Div,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq)]
pub enum UnOp {
    Neg,
    Plus,
}
```

The parser is implemented using the [Chumsky](https://github.com/zesterer/chumsky) crate which I highly recommend.

The parser code in the described state here can be found on [GitHub](https://github.com/romamik/typed-eval-rs/blob/803b8d7894c8b0dd136cd852f1b68f716fdf3a6d/crates/typed-eval/src/expr_parser.rs).

The parser module exports the `parse_expr` function. Calling `parse_expr("(1 + 2) / 3")` should return:

```
BinOp(Mul,
    BinOp(Add, Int(1), Int(2)),
    Int(3)
)
```

Git tag for this stage: [blog-001](https://github.com/romamik/typed-eval-rs/tree/blog-001)

## Interpreting the AST

To get started, let's implement a simple evaluation of the parsed expressions. For now, we can assume that the result of the evaluation is always of type `f64`.

```rs
fn eval_expr(expr: &Expr) -> Result<f64, String> {
    Ok(match expr {
        Expr::Int(val) => *val as f64,
        Expr::Float(val) => *val,
        Expr::String(_string) => Err("Strings not supported")?,
        Expr::Var(_var_name) => Err("Variables not supported")?,
        Expr::UnOp(op, rhs) => {
            let rhs = eval_expr(rhs)?;
            match op {
                UnOp::Neg => -rhs,
                UnOp::Plus => rhs,
            }
        }
        Expr::BinOp(op, lhs, rhs) => {
            let lhs = eval_expr(lhs)?;
            let rhs = eval_expr(rhs)?;
            match op {
                BinOp::Add => lhs + rhs,
                BinOp::Sub => lhs - rhs,
                BinOp::Mul => lhs * rhs,
                BinOp::Div => lhs / rhs,
            }
        }
        Expr::FieldAccess(_object, _field_name) => {
            Err("Field access not supported")?
        }
        Expr::FuncCall(_function, _arguments) => {
            Err("Function calls not supported")?
        }
    })
}
```

The code here is straightforward and barely needs any explanation.

I've also implemented `eval` function that calls `parse_expr` and then calls `eval_expr` on the result. So finally we can have a test:

```rs
#[test]
fn test_eval() {
    assert_eq!(eval("(1 + 2) * 3"), Ok(9.0));
}
```

Git tag for this stage: [blog-002](https://github.com/romamik/typed-eval-rs/tree/blog-002)

## Combining closures

It would not make sense to write a blog post if I did not intend to do something interesting. Now I am going to show you the first part of what we will do with our interpreter.

Interpreting an AST as shown above works, but for larger expressions, it can be slow. Additionally, if there are errors in the expression, such as for example, usage of the not yet implemented features, it can produce errors at the execution state. What if we precompile the expression to some other form that would be faster to execute and will always run without an error after compilation?

Let's create a function that takes an AST and returns a closure.

```diff lang=rs
+pub type CompiledExpr = Box<dyn Fn() -> f64>;

-pub fn eval_expr(expr: &Expr) -> Result<f64, String> {
+pub fn compile_expr(expr: &Expr) -> Result<CompiledExpr, String> {
     Ok(match expr {
-        Expr::Int(val) => *val as f64,
+        &Expr::Int(val) => Box::new(move || val as f64),
-        Expr::Float(val) => *val,
+        &Expr::Float(val) => Box::new(move || val),
         Expr::String(_string) => Err("Strings not supported")?,
         Expr::Var(_var_name) => Err("Variables not supported")?,
         Expr::UnOp(op, rhs) => {
-            let rhs = eval_expr(rhs)?;
+            let rhs = compile_expr(rhs)?;
             match op {
-                UnOp::Neg => -rhs,
+                UnOp::Neg => Box::new(move || -rhs()),
                 UnOp::Plus => rhs,
             }
         }
         Expr::BinOp(op, lhs, rhs) => {
-            let lhs = eval_expr(lhs)?;
-            let rhs = eval_expr(rhs)?;
+            let lhs = compile_expr(lhs)?;
+            let rhs = compile_expr(rhs)?;
             match op {
-                BinOp::Add => lhs + rhs,
-                BinOp::Sub => lhs - rhs,
-                BinOp::Mul => lhs * rhs,
-                BinOp::Div => lhs / rhs,
+                BinOp::Add => Box::new(move || lhs() + rhs()),
+                BinOp::Sub => Box::new(move || lhs() - rhs()),
+                BinOp::Mul => Box::new(move || lhs() * rhs()),
+                BinOp::Div => Box::new(move || lhs() / rhs()),
             }
         }
        Expr::FieldAccess(_object, _field_name) => {
            Err("Field access not supported")?
        }
        Expr::FuncCall(_function, _arguments) => {
            Err("Function calls not supported")?
        }
    })
}
```

Now to get the result of the expression we need to just call the returned closure:

```rs
let expr: &Expr = ...
let compiled_expr: CompiledExpr = compile_expr(expr)?;
let result: f64 = compiled_expr();
```

Looking at the resulting code, I think it is pretty useless right now, as expressions always return the same result. But we will get to it very soon.

Git tag for this stage: [blog-003](https://github.com/romamik/typed-eval-rs/tree/blog-003)

## Adding context

Let's make our closures accept a parameter whose fields will serve as variables that are accessible to expressions.

If we had a version that evaluates the AST we could have used `HashMap<String, f64>` for this and just return an error if the variable was not present. But now we have closures that should not fail, so let's have a type parameter both for our `compile_expr` function and for the returned closures.

```rs
pub type CompiledExpr<Ctx> = Box<dyn Fn(&Ctx) -> f64>;

pub fn compile_expr<Ctx: 'static>(
    expr: &Expr
) -> Result<CompiledExpr<Ctx>, String> {
...
    &Expr::Int(val) => Box::new(move |_ctx| val as f64),
...
    Expr::UnOp(op, rhs) => {
        let rhs = compile_expr(rhs)?;
        match op {
            UnOp::Neg => Box::new(move |ctx| -rhs(ctx)),
            UnOp::Plus => rhs,
        }
    }
```

### Implementing variable access

And with this we should be able to implement `Expr::Var` branch in our code that previously returned an error. But how can we access fields of the context object?

For this, we can create a trait that our `Context` should implement:

```rs
pub trait ExprContext: 'static {
    fn field_getter(field_name: &str) -> Option<fn(&Self) -> f64>;
}

pub fn compile_expr<Ctx: ExprContext>(
    expr: &Expr
) -> Result<CompiledExpr<Ctx>, String> {
...
    Expr::Var(var_name) => {
        let field_getter = Ctx::field_getter(var_name)
            .ok_or(format!("Unknown variable ${var_name}"))?;
        Box::new(field_getter)
    }
```

Here, `ExprContext::field_getter` function returns a function that can be used to access a given field of the context object. This may sound a bit confusing, but actually, the concept is really simple.

### Implementing ExprContext

Currently, to test our expression engine we can implement `ExprContext` by hand, but obviously, it would make a lot of sense to have a `Derive` macro to implement it for us.

```rs
struct TestContext {
    foo: f64,
    bar: f64,
}

impl ExprContext for TestContext {
    fn field_getter(field_name: &str) -> Option<fn(&Self) -> f64> {
        match field_name {
            "foo" => Some(|ctx: &TestContext| ctx.foo),
            "bar" => Some(|ctx: &TestContext| ctx.bar),
            _ => None,
        }
    }
}

#[test]
fn test_eval() {
    let ctx = TestContext { foo: 1.0, bar: 2.5 };
    assert_eq!(
        eval("(1 + 2) * 3", &ctx),
        Ok((1.0 + 2.0) * 3.0)
    );
    assert_eq!(
        eval("2 * (foo + bar)", &ctx),
        Ok(2.0 * (ctx.foo + ctx.bar))
    );
}
```

Git tag for this stage: [blog-004](https://github.com/romamik/typed-eval-rs/tree/blog-004)

## More types

The evaluation engine is more usable now, when it can access variables, but it cannot work with types other than `float64`, which can be quite limiting. For example, we may want to calculate a string dynamically. Also, it would be cool to implement field access, to compile expressions like `"user.age * 2"`. However, for that we would also need support for different types, because sub expression `"user"` will return a `User` object and not a `float64`.

We can change our `CompiledExpr` type like this:

```rs
pub type CompiledExpr<Ctx, Ret> = Box<dyn Fn(&Ctx) -> Ret>;
```

But we can't just adapt the `compile_expr` function to this new definition, because we don't know the return type of the expression: `"100"` will return `i64` and `"\"Hello world\""` will return `String`. That means that we need some common return type that will hold the compiled expression.

### Dynamic functions

We need a type that does not have the `Ret` type parameter, but holds information about the return type so that the compiler can use it.

Pseudocode for what the `compile_expr` might want to do:

```
lookup_function(op: BinOp, lhs: Type, rhs: Type) {
    match (op, lhs, rhs) {
        ...
        case (BinOp::Add, Int, Int) => |lhs: DynFn, rhs: DynFn| {
            let lhs: Fn(Ctx)->Int = lhs.downcast<Int>()
            let rhs: Fn(Ctx)->Int = rhs.downcast<Int>()
            DynFn::new(|ctx| lhs() + rhs())
        }
        ...
    }
}

fn compile_expr(expr: &Expr) -> DynFn {
    match expr {
        Expr::Int(val) => make_function_returning_int(|ctx| val)
        Expr::BinOp(op, lhs, rhs) => {
            let lhs = compile_expr(lhs)
            let rhs = compile_expr(rhs)
            let op_fun = lookup_function(op, lhs.type, rhs.type)
            op_fun(lhs, rhs)
        }
    }
}
```

Or in human words, the compiler knows how to add certain types, so when it encounters the addition operator, it finds out which types are the operands, and finds the right operation based on the types, and calls appropriate code. This code already knows which types the operands are and can downcast them statically.

First, we need a type-erased function type that we can downcast back to fully typed function. My first attempt at defining such types:

```rs
// the function with a statically known type
pub type BoxedFn<Arg, Ret> = Box<dyn Fn(&Arg) -> Ret>;

// the function with a dynamically known type
pub struct DynFn {
    boxed_fun: Box<dyn Any>,
    arg_type: TypeId,
    ret_type: TypeId,
}

impl DynFn {
    pub fn new<Arg, Ret>(f: impl Fn(&Arg) -> Ret + 'static) -> Self
    where
        Arg: 'static,
        Ret: 'static,
    {
        let boxed_fun: BoxedFn<Arg, Ret> = Box::new(f);
        Self {
            boxed_fun: Box::new(boxed_fun),
            arg_type: TypeId::of::<Arg>(),
            ret_type: TypeId::of::<Ret>(),
        }
    }

    pub fn downcast<Arg, Ret>(&self) -> Option<&BoxedFn<Arg, Ret>>
    where
        Arg: 'static,
        Ret: 'static,
    {
        self.boxed_fun.downcast_ref()
    }
}

#[test]
fn test_dyn_fn() {
    // here we construct a function that takes an (i32,i32) tuple
    // and returns the first part, but the type of the variable is
    // just DynFn, no mention of tuples and i32
    let dyn_fn = DynFn::new(|a: &(i32, i32)| a.0);

    // here we get back to the callable function with known types
    // but for that we need to know exact types at compile time
    let concrete_fn = dyn_fn.downcast::<(i32, i32), i32>().unwrap();

    // and here we call the downcasted function to test it
    assert_eq!((concrete_fn)(&(10, 20)), 10);
}
```

This works, but there is one aspect missing. When the compiler constructs a new closure by combining any previous ones, all previous closures are moved into that new closure, and the compiler has some closures stored and reused during compilation, like for example a function that adds two integers. Because of this, we need to be able to clone our functions.

For this, I introduce a new trait:

```rs
pub trait ClonableFn<Arg, Ret>: Fn(&Arg) -> Ret {
    fn clone_box(&self) -> Box<dyn ClonableFn<Arg, Ret>>;
}
```

Then we can implement it for all the matching functions:

```rs
impl<Arg, Ret, F> ClonableFn<Arg, Ret> for F
where
    F: Fn(&Arg) -> Ret + Clone + 'static,
{
    fn clone_box(&self) -> Box<dyn ClonableFn<Arg, Ret>> {
        Box::new(self.clone())
    }
}
```

After this, we have to change the `BoxedFn` definition:

```diff lang=rs
-   pub type BoxedFn<Arg, Ret> = Box<dyn Fn(&Arg) -> Ret>;
+   pub type BoxedFn<Arg, Ret> = Box<dyn ClonableFn<Arg, Ret>>;
```

Finally we can make the `downcast` function return a clone of the function instead of the reference:

```rs
pub fn downcast<Arg, Ret>(&self) -> Option<BoxedFn<Arg, Ret>>
where
    Arg: 'static,
    Ret: 'static,
{
    self.boxed_fun.downcast_ref()
        .map(|boxed: &BoxedFn<Arg, Ret>| boxed.clone_box())
}
```

But weirdly, this does not compile:

```
error[E0521]: borrowed data escapes outside of method
  --> crates/typed-eval/src/lib.rs:55:46
   |
48 |     pub fn downcast<Arg, Ret>(&self) -> Option<BoxedFn<Arg, Ret>>
   |                               -----
   |                               |
   |      `self` is a reference that is only valid in the method body
   |                    let's call the lifetime of this reference `'1`
...
55 |             .map(|boxed: &BoxedFn<Arg, Ret>| boxed.clone_box())
   |                                              ^^^^^^^^^^^^^^^^^
   |                                              |
   |                             `self` escapes the method body here
   |               argument requires that `'1` must outlive `'static`
```

I think, there is no doubt that `Box<dyn ClonableFn<Arg, Ret>>` is `'static`. But due to `ClonableFn` trait extending an `Fn(&Arg)` trait there is some lifetime associated with the `&Arg` argument, and this lifetime prevents the Rust compiler from clearly understanding that `Box<dyn ClonableFn<Arg, Ret>>` is actually `'static`. Or at least, this is my understanding of what is going on here.

The simplest solution for me was to just wrap the `Box` in a `struct` and adapt the code accordingly:

```rs showLineNumbers=false collapse={5-10,12-16,24-30,41-52,55-60}
// the function with a statically known type
pub struct BoxedFn<Arg, Ret>(Box<dyn ClonableFn<Arg, Ret>>);

impl<Arg, Ret> Clone for BoxedFn<Arg, Ret> {
    fn clone(&self) -> Self {
        self.clone_boxed()
    }
}

// implementing Deref allows to use the call syntax on the BoxedFn instances
impl<Arg, Ret> Deref for BoxedFn<Arg, Ret> {
    type Target = Box<dyn ClonableFn<Arg, Ret>>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

pub trait ClonableFn<Arg, Ret>: Fn(&Arg) -> Ret {
    fn clone_boxed(&self) -> BoxedFn<Arg, Ret>;
}

// implement ClonableFn for every matching function
impl<Arg, Ret, F> ClonableFn<Arg, Ret> for F
where
    F: Fn(&Arg) -> Ret + Clone + 'static,
{
    fn clone_boxed(&self) -> BoxedFn<Arg, Ret> {
        BoxedFn(Box::new(self.clone()))
    }
}

// the function with a dynamically known type
pub struct DynFn {
    boxed_fun: Box<dyn Any>,
    arg_type: TypeId,
    ret_type: TypeId,
}

impl DynFn {
    pub fn new<Arg, Ret>(
        f: impl Fn(&Arg) -> Ret + Clone + 'static
    ) -> Self
    where
        Arg: 'static,
        Ret: 'static,
    {
        Self {
            boxed_fun: Box::new(BoxedFn(Box::new(f))),
            arg_type: TypeId::of::<Arg>(),
            ret_type: TypeId::of::<Ret>(),
        }
    }

    pub fn downcast<Arg, Ret>(&self) -> Option<BoxedFn<Arg, Ret>>
    where
        Arg: 'static,
        Ret: 'static,
    {
        self.boxed_fun.downcast_ref().cloned()
    }
}

#[test]
fn test_dyn_fn() {
    // here we construct a function that takes an (i32,i32) tuple
    // and returns the first part, but the type of the variable is
    // just DynFn, no mention of tuples and i32
    let dyn_fn = DynFn::new(|a: &(i32, i32)| a.0);

    // here we get back to the callable function with known types
    // but for that we need to know exact types at compile time
    let concrete_fn = dyn_fn.downcast::<(i32, i32), i32>().unwrap();

    // and here we call the downcasted function to test it
    assert_eq!((concrete_fn)(&(10, 20)), 10);
}
```

Now that we have types to hold the functions, we can think about how to use them in the compiler.

### Using dynamic functions

Let's first adapt our existing code to using the new types. It will still only support `float64` but potentially we would be able to add more:

```rs
pub fn compile_expr<Ctx: ExprContext>(
    expr: &Expr
) -> Result<DynFn, String> {
...
    Expr::BinOp(op, lhs, rhs) => {
        let lhs = compile_expr::<Ctx>(lhs)?;
        let rhs = compile_expr::<Ctx>(rhs)?;
        if lhs.ret_type == TypeId::of::<f64>()
            && rhs.ret_type == TypeId::of::<f64>()
        {
            let lhs = lhs
                .downcast::<Ctx, f64>()
                .ok_or("Compiler error: lhs type mismatch")?;
            let rhs = rhs
                .downcast::<Ctx, f64>()
                .ok_or("Compiler error: rhs type mismatch")?;

            match op {
                BinOp::Add => {
                    DynFn::new(move |ctx| lhs(ctx) + rhs(ctx))
                }
                BinOp::Sub => {
                    DynFn::new(move |ctx| lhs(ctx) - rhs(ctx))
                }
                BinOp::Mul => {
                    DynFn::new(move |ctx| lhs(ctx) * rhs(ctx))
                }
                BinOp::Div => {
                    DynFn::new(move |ctx| lhs(ctx) / rhs(ctx))
                }
            }
        } else {
            Err("Unsupported binary operation")?
        }
    }
```

In the code above, we check if the compiled expressions are of expected type and downcast them to the types known in the `if` branch. Note that the downcast happens during compilation and not during the execution of the compiled function.

### Compiler registry

We definitely can add support for more types by just adding more `if` branches, but that would not be convenient in any way. My idea is to have the `Compiler`, that will actually hold the registry of the supported operations so that the `compile_expr` function can look up operations there and use them.

Something like this:

```rs
type BinOpKey = (BinOp, TypeId);
type CompileBinOpFunc =
    Box<dyn Fn(DynFn, DynFn) -> Result<DynFn, String>>;

pub struct Compiler<Ctx> {
    binary_operations: HashMap<BinOpKey, CompileBinOpFunc>,
    ctx_type: PhantomData<Ctx>,
}

impl<Ctx: ExprContext> Default for Compiler<Ctx> {
    fn default() -> Self {
        let mut compiler = Self {
            binary_operations: HashMap::new(),
            ctx_type: PhantomData,
        };

        compiler.register_bin_op(
            BinOp::Add,
            |lhs: f64, rhs: f64| lhs + rhs
        );
        compiler.register_bin_op(
            BinOp::Sub,
            |lhs: f64, rhs: f64| lhs - rhs
        );
        compiler.register_bin_op(
            BinOp::Mul,
            |lhs: f64, rhs: f64| lhs * rhs
        );
        compiler.register_bin_op(
            BinOp::Div,
            |lhs: f64, rhs: f64| lhs / rhs
        );

        compiler
    }
}

impl<Ctx: ExprContext> Compiler<Ctx> {
    fn register_bin_op<T: 'static>(
        &mut self,
        op: BinOp,
        bin_op_fn: fn(T, T) -> T
    ) {
        let key = (op, TypeId::of::<T>());
        let compile_func = Box::new(
            move |lhs: DynFn, rhs: DynFn| -> Result<DynFn, String> {
                let lhs = lhs
                    .downcast::<Ctx, T>()
                    .ok_or("Compiler error: lhs type mistmatch")?;
                let rhs = rhs
                    .downcast::<Ctx, T>()
                    .ok_or("Compiler error: rhs type mistmatch")?;
                Ok(DynFn::new(move |ctx| bin_op_fn(lhs(ctx), rhs(ctx))))
            },
        );
        self.binary_operations.insert(key, compile_func);
    }
}
```

With this in place, we can make `compile_expr` also a method of the `Compiler` and use the registry for binary operations:

```rs
pub fn compile_expr(&self, expr: &Expr) -> Result<DynFn, String> {
    ..
    Expr::BinOp(op, lhs, rhs) => {
        let lhs = self.compile_expr(lhs)?;
        let rhs = self.compile_expr(rhs)?;
        if lhs.ret_type != rhs.ret_type {
            Err(
                "Different types of operands are not supported for binary operators",
            )?
        }

        let Some(compile_bin_op) =
            self.binary_operations.get(&(*op, lhs.ret_type))
        else {
            Err("Unsupported binary operation")?
        };

        compile_bin_op(lhs, rhs)?
    }
```

### Casting

I decided that binary operations will only take arguments of the same type. I think this is fine, but still it would be great to support operations such as `int + float`. For this, we can add a concept of casting to the compiler. The compiler will have registered possible casts, and when it encounters an operation for which some exact type is needed it can try to cast expression at hand to this type.

For binary operators, if the arguments have different type, we can try to cast either of operands to the type of the other operand. This seems to work fine: let's say we have a cast from `int` to `float`, then `int + float` would be interpreted as `cast(int) + float`.

Let's implement this:

```rs showLineNumbers=false collapse={20-31}
type CastKey = (TypeId, TypeId);
type CompileCastFunc = Box<dyn Fn(DynFn) -> Result<DynFn, String>>;

pub struct Compiler<Ctx> {
    casts: HashMap<CastKey, CompileCastFunc>,
    ...
}

impl<Ctx: ExprContext> Default for Compiler<Ctx> {
    fn default() -> Self {
        ...
        // cast from integer to float
        compiler.register_cast(|value: i64| value as f64);

        // binary operators for integers
        compiler.register_bin_op(
            BinOp::Add,
            |lhs: i64, rhs: i64| lhs + rhs
        );
        compiler.register_bin_op(
            BinOp::Sub,
            |lhs: i64, rhs: i64| lhs - rhs
        );
        compiler.register_bin_op(
            BinOp::Mul,
            |lhs: i64, rhs: i64| lhs * rhs
        );
        compiler.register_bin_op(
            BinOp::Div,
            |lhs: i64, rhs: i64| lhs / rhs
        );
        ...
    }
}

impl<Ctx: ExprContext> Compiler<Ctx> {
    fn register_cast<From: 'static, To: 'static>(
        &mut self,
        cast_fn: fn(From) -> To
    ) {
        let key = (TypeId::of::<From>(), TypeId::of::<To>());
        let compile_func = Box::new(
            move |from: DynFn| -> Result<DynFn, String> {
                let from = from
                    .downcast::<Ctx, From>()
                    .ok_or("Compiler error: from type mistmatch")?;
                Ok(DynFn::new(move |ctx| cast_fn(from(ctx))))
            }
        );
        self.casts.insert(key, compile_func);
    }
    ...
    // helper function that tries to cast expression to given type
    fn cast(
        &self,
        expr: DynFn, ty: TypeId
    ) -> Result<DynFn, String> {
        if expr.ret_type == ty {
            return Ok(expr);
        }
        let key = (expr.ret_type, ty);
        let Some(compile_cast_func) = self.casts.get(&key) else {
            Err("Cannot cast")?
        };
        compile_cast_func(expr)
    }

    // helper functions that tries to make two expressions the same type
    fn cast_same_type(
        &self, a: DynFn,
        b: DynFn
    ) -> Result<(DynFn, DynFn), String> {
        if a.ret_type == b.ret_type {
            return Ok((a, b));
        }
        if let Ok(b_casted) = self.cast(b.clone(), a.ret_type) {
            return Ok((a, b_casted));
        }
        if let Ok(a_casted) = self.cast(a, b.ret_type) {
            return Ok((a_casted, b));
        }
        Err("Cannot cast to same type".to_string())
    }
    ...
    pub fn compile_expr(&self, expr: &Expr) -> Result<DynFn, String> {
        ...
        // NOTE: return i64 val here now, so the resulting expression
        // will be of i64 type
        &Expr::Int(val) => DynFn::new(move |_ctx: &Ctx| val),
        ...
        Expr::BinOp(op, lhs, rhs) => {
            let lhs = self.compile_expr(lhs)?;
            let rhs = self.compile_expr(rhs)?;

            let (lhs, rhs) = self.cast_same_type(lhs, rhs)?;

            let Some(compile_bin_op) = {
                self.binary_operations.get(&(*op, lhs.ret_type))
            } else {
                Err("Unsupported binary operation")?
            };

            compile_bin_op(lhs, rhs)?
        }
        ...
    }
    ...
    // very convenient function that returns function
    // that we can call instead of DynFn
    pub fn compile<Ret: 'static>(
        &self,
        expr: &Expr
    ) -> Result<BoxedFn<Ctx, Ret>, String> {
        let dyn_fn = self.compile_expr(expr)?;
        let casted_dyn_fn = self.cast(dyn_fn, TypeId::of::<Ret>())?;
        casted_dyn_fn
            .downcast::<Ctx, Ret>()
            .ok_or("Compiler error: type mismatch".to_string())
    }
}
```

We will also need to implement the remaining features, such as unary operators, in the same manner. However, I will not put this here, as the code is more or less obvious. It is still present in the repository anyway.

Oh, and I forgot to say: I had to make `DynFn` clonable to implement `cast_same_type` function. I used the same `clone_box` trick we already used with `ClonableFn` trait.

Git tag for this stage: [blog-005](https://github.com/romamik/typed-eval-rs/tree/blog-005)

## Field access

I would like to implement a field access feature now. So that our expressions can look like `"user.age * 0.5"`. But for this we need to have the expression `"user"` to work, which should return some sort of object. And here are the two reasons we cannot have it right now: our context, or local variables, still can only return `float` values, and there is no object type in the compiler.

### Local variables

Our expressions can have types now, but what about fields of the `Context`? They are still `float` only. Let's fix that.

Our `ExprContext` trait looked like that:

```rs
pub trait ExprContext: 'static {
    fn field_getter(field_name: &str) -> Option<fn(&Self) -> f64>;
}
```

We now have `DynFn` type that can store a function that takes (a reference to) any argument and returns any result type. We can reuse it in the `Context` trait:

```rs
pub trait ExprContext: 'static {
    // returns a function that takes Self as argument
    fn field_getter(field_name: &str) -> Option<DynFn>;
}
```

And now our compiler code for `Expr::Var` is really simple, we just return a DynFn returned from ExprContext:

```rs
    Expr::Var(var_name) => Ctx::field_getter(var_name)
        .ok_or(format!("Unknown variable ${var_name}"))?,
```

In our test, we can now change a type of one of the fields and update the implementation of the ExprContext:

```rs
struct TestContext {
    foo: i64,
    bar: f64,
}

impl ExprContext for TestContext {
    fn field_getter(field_name: &str) -> Option<DynFn> {
        match field_name {
            "foo" => Some(DynFn::new(|ctx: &TestContext| ctx.foo)),
            "bar" => Some(DynFn::new(|ctx: &TestContext| ctx.bar)),
            _ => None,
        }
    }
}
```

And that is all what took us to have local variables of any type we want.

It is still worth it to create a `Derive` macro for this, but I still plan to implement it later.

### Object type

It looks like we can just add a field of any type to our context and the compiler will just use it. The only limitation we have is that return type of our expressions should be `static`. So, we should be able to have the context defined like this:

```rs
struct Foo {}

struct Context {
    foo: Foo
}

impl ExprContext for Context {
    fn field_getter(field_name: &str) -> Option<DynFn> {
        match field_name {
            "foo" => Some(DynFn::new(|ctx: &Context| ctx.foo)),
            _ => None,
        }
    }
}
```

This will not compile:

```
error[E0507]: cannot move out of `ctx.foo` which is behind a shared reference
```

If we try to return a reference to foo:

```rs
    "foo" => Some(DynFn::new(|ctx: &Context| &ctx.foo)),
```

The error is different, but it still does not compile:

```
error: lifetime may not live long enough
```

I think the reasons for both errors are obvious, but what can we do about it? The easiest thing to do would be to just clone `foo` and return it. I really do not think that it is a good solution though. Instead, let's use `Rc` for storing `Foo` in the context, and clone the `Rc`:

```rs
struct Context {
    int: i64,
    float: f64,
    foo: Rc<Foo>,
}

impl ExprContext for Context {
    fn field_getter(field_name: &str) -> Option<DynFn> {
        match field_name {
            "int" => Some(DynFn::new(|ctx: &Context| ctx.int.clone())),
            "float" => Some(DynFn::new(|ctx: &Context| ctx.float.clone())),
            "foo" => Some(DynFn::new(|ctx: &Context| ctx.foo.clone())),
            _ => None,
        }
    }
}
```

Note, that I added `clone()` to `int` and `float` fields too. There is no harm in this, but this way it mimics the way it will be generated by `Derive` macro, so we are sure that we will be able to implement it.

I think I know the trick to get rid of this `Rc` and actually have the compiled function return the reference to `foo`, but we will get to it later. 

### Field access

Now we can have an expression that returns an object. So, when compiling an `Expr::FieldAccess` we will have a function that returns an `Rc<SomeType>` and a field name. But how the compiler knows how to extract the field from the instance of the type. I think we should register types with the compiler, so that it stores all needed information. Actually, we already have the `ExprContext` context trait, that we can register with compiler, as it does exactly what we need: allows to get a field from the object of the known type.

Pseudocode:
```
register_type::<Type: ExprContext>() {
    for each field register a getter function with the compiler
}

compile_field_access(object, field_name) {
    by type_id of the object and field_name find the getter function and use it
}
```

Looking at this, I can say that our trait lacks a way to enumerate fields. Also, `ExprContext` is now a bad name for this trait, as it is now not only for the evaluation context of the expression, but also for any other objects.

What if our trait will look like this:
```rs
trait SupportedType {
    fn register(compiler: &mut Compiler)
}
```

This way, for objects we can not only register all the field getters with compiler, but also register types for all the field types. Also, simple types like i64 can register binary and unary operators as well as casts associated with them. This will allow to structure our code in a more modulare manner. Seems like a good way to do.

For this we will need a mutable access to the compiler, and also to make `register_` function on the compiler public. This does not sound really good to me. So, I propose to have a CompilerRegistry type, and the final structure will look like this, that is still pseudocode:
```rs
struct Compiler<Ctx> {
    registry: CompilerRegistry<Ctx>
}

impl<Ctx: SupportedType> Compiler<Ctx> {
    fn new() {
        let mut registry = CompilerRegistry::default()
        Ctx::register(&mut registry)
        
        // all the types that can we have literals of
        i64::register()
        f64::register()

        Self { registry }
    }
}

impl SupportedType for SomeContext {
    fn register(registry) {
        // for every field:
        registry.register_field_access("foo", |obj: Self| obj.foo)
        
        // for every field type:
        FieldType::register(registry)
    }
}

impl SupportedType for i64 {
    fn register(registry) {
        // register cast to f64
        // register all binary and unary operations
    }
}
```