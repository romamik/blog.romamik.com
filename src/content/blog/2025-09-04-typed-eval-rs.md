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
        Expr::FieldAccess(_object, _field_name) => Err("Field access not supported")?,
        Expr::FuncCall(_function, _arguments) => Err("Function calls not supported")?,
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
        Expr::FieldAccess(_object, _field_name) => Err("Field access not supported")?,
        Expr::FuncCall(_function, _arguments) => Err("Function calls not supported")?,
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

pub fn compile_expr<Ctx>(expr: &Expr) -> Result<CompiledExpr<Ctx>, String> {
        &Expr::Int(val) => Box::new(move |_ctx| val as f64),
...
        Expr::UnOp(op, rhs) => {
            let rhs = compile_expr(rhs)?;
            match op {
                UnOp::Neg => Box::new(move |ctx| -rhs(ctx)),
                UnOp::Plus => rhs,
            }
        }
...
```

### Adding `'static` constraint to the context

Surprisingly, this does not compile with the following error:

```
error[E0310]: the parameter type `Ctx` may not live long enough

    UnOp::Neg => Box::new(move |ctx| -rhs(ctx)),
                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
help: consider adding an explicit lifetime bound

pub fn compile_expr<Ctx: 'static>(expr: &Expr)
                       +++++++++
```

Let's just follow the suggested fix and it now compiles. Basically, this means that our context should not contain references, and this does not look like would limit us in using our expressions.

### Implementing variable access

And with this we should be able to implement `Expr::Var` branch in our code that previously returned an error. But how can we access fields of the context object?

For this, we can create a trait that our `Context` should implement:

```rs
pub trait ExprContext: 'static {
    fn field_getter(field_name: &str) -> Option<fn(&Self) -> f64>;
}

pub fn compile_expr<Ctx: ExprContext>(expr: &Expr) -> Result<CompiledExpr<Ctx>, String> {
...
        Expr::Var(var_name) => {
            let field_getter =
                Ctx::field_getter(var_name).ok_or(format!("Unknown variable ${var_name}"))?;
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
        assert_eq!(eval("(1 + 2) * 3", &ctx), Ok((1.0 + 2.0) * 3.0));
        assert_eq!(eval("2 * (foo + bar)", &ctx), Ok(2.0 * (ctx.foo + ctx.bar)));
    }
```

Git tag for this stage: [blog-004](https://github.com/romamik/typed-eval-rs/tree/blog-004)

## More types

The evaluation engine is more usable now, when it can access variables, but it cannot work with types other than `float64`, which can be quite limiting. For example, we may want to calculate a string dynamically. Also, it would be cool to implement field access, to compile expressions like `"user.age * 2"`. However, for that we would also need support for different types, because sub expression `"user"` will return a `User` object and not a `float64`.