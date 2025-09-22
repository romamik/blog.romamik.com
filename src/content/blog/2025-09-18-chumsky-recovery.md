---
title: "Chumsky Parser Recovery"
pubDate: 2025-09-19
description: "How to make your Chumsky parser handle mistakes gracefully."
draft: false
---

I have a project with a parser written using [chumsky](https://github.com/zesterer/chumsky).

Recently, I decided to add error recovery to the parser. It took more time than I expected, mostly due to my misunderstanding of what it is and how it works. Now that I’ve figured it out, I cannot even remember what mental model I initially had.

## Parsing a Single Integer

This code parses a single int-like string from the input:

```rs
use chumsky::{extra, prelude::*};

fn main() {
    let int_parser = text::int::<&str, extra::Err<Rich<char>>>(10)
        .padded();
    dbg!(int_parser.parser("100"))
}
```

We want our parser to recover from errors, so let's add some errors to the input. We want recoverable errors, meaning there should still be something to parse.

## Handling Unexpected Characters Before the Number

One possible error is extra characters before the valid input:

```rs
dbg!(int_parser.parse("abc 100"));
```

To deal with it, we can add recovery to our parser:

```rs
use chumsky::{extra, prelude::*};

fn main() {
    let int_parser = text::int::<&str, extra::Err<Rich<char>>>(10)
        .padded()
        .recover_with(skip_then_retry_until(any().ignored(), end()));
    dbg!(int_parser.parse("abc 100"));
}
```

The output:

```
int_parser.parse("abc 100") = ParseResult {
    output: Some("100"),
    errs: [
        found ''a'' at 0..1 expected non-zero digit, or ''0'',
    ],
}
```

It worked! We can see `output: Some("100")` in the result. The error is also reported. This is how error recovery is supposed to work: recover from errors, but still report them.

We added `.recover_with(skip_then_retry_until(any().ignored(), end()))`. What does it mean?

`recover_with` accepts a recovery strategy. It is called when the underlying parser fails.

`skip_then_retry_until(skip, until)` is a recovery strategy. `skip` and `until` are parsers. It works in a loop: it calls the `until` and `skip` parsers once, then tries the original failed parser again. If `until` succeeds, the recovery strategy stops. If `skip` fails, the recovery strategy also fails.

So `recover_with(skip_then_retry_until(any().ignored(), end()))` means:

```
while not at the end of the input:
    skip any character
    try the original parser again (text::int in our case)
```

## Recovering from Trailing Garbage

Another possible error is extra characters after the valid input:

```rs
dbg!(int_parser.parse("100 abc"));
```

This is an error only because we are calling the `parse` function, which checks that the whole input was consumed. The parser itself would happily stop, and if used with another parser, no error would be produced. For example, this parser uses our `int_parser` and does not fail:

```rs
assert!(!int_parser.then(ident()).parse("100 abc").has_errors());
```

But for completeness, let's recover from this error too. We'll explicitly expect `end()` after the int and recover if that parser fails:

```rs
let whole_string_int_parser = int_parser
    .then_ignore(end()
    .recover_with(skip_then_retry_until(any().ignored(), end())));
dbg!(whole_string_int_parser.parse("100 abc"));
```

The output shows that this recovery strategy works:

```
whole_string_int_parser.parse("100 abc") = ParseResult {
    output: Some("100"),
    errs: [
        found ''a'' at 4..5 expected end of input,
    ],
}
```

## Parsing Lists of Integers

Let's extend our parser to accept a list of ints:

```rs
let int_parser = text::int::<&str, extra::Err<Rich<char>>>(10)
    .padded()
    .recover_with(skip_then_retry_until(any().ignored(), end()));

let int_list_parser = int_parser.separated_by(just(',')).collect::<Vec<_>>();

dbg!(int_list_parser.parse("10, 20"));
dbg!(int_list_parser.parse("a 10, a 20"));
```

Our recovery strategy still works; both calls to `parse` produced a list of `["10", "20"]`, and the errors were reported in the second case:

```
int_list_parser.parse("10, 20") = ParseResult {
    output: Some(["10", "20"]),
    errs: [],
}
int_list_parser.parse("a 10, a 20") = ParseResult {
    output: Some(["10", "20"]),
    errs: [
        found ''a'' at 0..1 expected non-zero digit, or ''0'',
        found ''a'' at 6..7 expected non-zero digit, or ''0'',
    ],
}
```

But what if we add invalid characters after an int?

```rs
dbg!(int_list_parser.parse("10 abc, 20"));
```

In this example, the separator parser `just(',')` fails, so our recovery does not help. Let's add recovery to the separator parser as well:

```rs
let int_list_parser = int_parser
    .separated_by(
        just(',').recover_with(skip_then_retry_until(any().ignored(), end()))
    )
    .collect::<Vec<_>>();
```

This recovery skips any characters until the comma is successfully parsed.

## Wrapping Lists in Brackets

Let's put our list into brackets:

```rs
let int_list_parser = int_parser
    .separated_by(
        just(',').recover_with(skip_then_retry_until(any().ignored(), just(']').ignored())),
    )
    .collect::<Vec<_>>()
    .delimited_by(just('['), just(']'))
    .padded();

dbg!(int_list_parser.parse("[10 abc, 20]"));
```

We don't want recovery for the comma to go outside the delimiter:

```rs
.separated_by(
    just(',').recover_with(skip_then_retry_until(any().ignored(), just(']').ignored())),
)
```

Now let's put invalid characters before the closing bracket:

```rs
dbg!(int_list_parser.parse("[10, 20 abc]"));
```

This parser fails to recover because parsing of the closing bracket fails. Let's add recovery to that parser:

```rs
let int_list_parser = int_parser
    .separated_by(
        just(',').recover_with(skip_then_retry_until(any().ignored(), just(']').ignored())),
    )
    .collect::<Vec<_>>()
    .delimited_by(
        just('['),
        just(']').recover_with(skip_then_retry_until(any().ignored(), end())),
    )
    .padded();

dbg!(int_list_parser.parse("[abc 10 abc , abc 20 abc]"));
```

The output shows that we successfully recovered all invalid input:

```
int_list_parser.parse("[abc 10 abc , abc 20 abc]") = ParseResult {
    output: Some(["10", "20"]),
    errs: [
        found ''a'' at 1..2 expected non-zero digit, or ''0'',
        found ''a'' at 8..9 expected '','',
        found ''a'' at 14..15 expected non-zero digit, or ''0'',
        found ''a'' at 21..22 expected '','', or '']'',
    ],
}
```

## Nested Lists: Recursive Parsing and Recovery

Now let's allow our list to contain nested lists:

```rs
#[derive(Debug)]
enum Ast<'a> {
    Item(&'a str),
    List(Vec<Ast<'a>>),
}

fn main() {
    let int_parser = text::int::<&str, extra::Err<Rich<char>>>(10)
        .padded()
        .map(Ast::Item);
    //.recover_with(skip_then_retry_until(any().ignored(), end()));

    let ast_parser = recursive(|ast_parser| {
        let list_parser = ast_parser
            .separated_by(
                just(',').recover_with(skip_then_retry_until(any().ignored(), just(']').ignored())),
            )
            .collect::<Vec<_>>()
            .map(Ast::List)
            .delimited_by(
                just('['),
                just(']').recover_with(skip_then_retry_until(any().ignored(), end())),
            )
            .padded();

        choice((int_parser, list_parser))
    });

    dbg!(ast_parser.parse("[10, [20, 30]]"));
}
```

Note the commented-out recovery on `int_parser`. I removed it because it breaks the `choice` parser.

The `choice` parser tries parsers in order until one succeeds. With recovery, `int_parser` succeeds even when it shouldn't. In this example, it consumes `"[10` producing `Ast::Item(10)` and an error, so the parser never enters the state where it would parse a list.

We can fix this by reattaching recovery to `choice`:

```rs
let int_parser = text::int::<&str, extra::Err<Rich<char>>>(10).map(Ast::Item);

let ast_parser = recursive(|ast_parser| {
    let list_parser = ast_parser
        .separated_by(
            just(',').recover_with(skip_then_retry_until(any().ignored(), just(']').ignored())),
        )
        .collect::<Vec<_>>()
        .map(Ast::List)
        .delimited_by(
            just('['),
            just(']').recover_with(skip_then_retry_until(any().ignored(), end())),
        );

    choice((int_parser, list_parser))
        .padded()
        .recover_with(skip_then_retry_until(any().ignored(), end()))
});
```

This parser successfully parses inputs with various invalid sequences:

```rs
dbg!(ast_parser.parse("a 10"));
dbg!(ast_parser.parse("[a 10 b, c [20, 30] e]"));
dbg!(ast_parser.parse("[a 10 b, [a 20 b, c 30 d]]"));
```

All examples produce the expected AST and report errors. But parsing fails for:

```rs
dbg!(ast_parser.parse("[10, a [b 20, 30], 40]"));
```

Output:

```
ast_parser.parse("[10, a [b 20, 30], 40]") = ParseResult {
    output: None,
    errs: [
        found ''a'' at 5..6 expected non-zero digit, ''0'', or ''['',
        found '','' at 17..18 expected end of input,
    ],
}
```

The last error indicates that parsing successfully reached the last closing bracket but expected the input to end there. My theory: it encounters `a`, the `choice` parser fails, and recovery skips to `20` as the item of the outer list.

We can recover from the last error, `expected end of input`, using the same trick as `whole_string_int_parser`:

```rs
let ast_parser = recursive(|ast_parser| {
    ...
})
.then_ignore(end().recover_with(skip_then_retry_until(any().ignored(), end())));
```

Now the output supports my theory:

```
ast_parser.parse("[10, a [b 20, 30], 40]") = ParseResult {
    output: Some(
        List([Item("10"),Item("20"),Item("30")]),
    ),
    errs: [
        found ''a'' at 5..6 expected non-zero digit, ''0'', or ''['',
        found '','' at 17..18 expected end of input,
    ],
}
```

Chumsky does not seem to allow recursive recovery. If it did, the parser would attempt the list inside `[b 20 ...]` and recover better.

I did not find an ultimate solution for this, but I was still able to achieve a slightly better result:

```rs
choice((int_parser, list_parser))
    .padded()
    .recover_with(via_parser(
        none_of(",[")
            .repeated()
            .ignore_then(nested_delimiters('[', ']', [], |_| Ast::Error)),
    ))
    .recover_with(skip_then_retry_until(any().ignored(), end()))
```

Here, `via_parser` is a recovery strategy that succeeds if the parser you pass to it succeeds. In our case, the parser inside skips any character until it finds a comma or an opening bracket, and then attempts to skip over the nested brackets entirely. This means that the strategy will fail if there is no opening bracket before the next comma, but if there is one, it will skip the whole nested list.

The `via_parser` strategy never retries the original parser. However, because the recovery strategy must return the same type as the original parser, I had to introduce a new Ast variant to represent errors.

## The final code 

The final code:

```rs
use chumsky::{extra, prelude::*};

#[derive(Debug)]
enum Ast<'a> {
    Item(&'a str),
    List(Vec<Ast<'a>>),
    Error,
}

fn main() {
    let int_parser = text::int::<&str, extra::Err<Rich<char>>>(10).map(Ast::Item);

    let ast_parser = recursive(|ast_parser| {
        let list_parser = ast_parser
            .separated_by(
                just(',').recover_with(skip_then_retry_until(any().ignored(), just(']').ignored())),
            )
            .collect::<Vec<_>>()
            .map(Ast::List)
            .delimited_by(
                just('['),
                just(']').recover_with(skip_then_retry_until(any().ignored(), end())),
            );

        choice((int_parser, list_parser))
            .padded()
            .recover_with(via_parser(
                none_of(",[")
                    .repeated()
                    .ignore_then(nested_delimiters('[', ']', [], |_| Ast::Error)),
            ))
            .recover_with(skip_then_retry_until(any().ignored(), end()))
    })
    .then_ignore(end().recover_with(skip_then_retry_until(any().ignored(), end())));

    dbg!(ast_parser.parse("[a 10 b, c [ d 20 e, f 30 g] e, f 40 g] h"));
}
```

Output:

```
ast_parser.parse("[a 10 b, c [ d 20 e, f 30 g] e, f 40 g] h") = ParseResult {
    output: Some(
        List([Item("10"),Error,Item("40")]),
    ),
    errs: [
        found ''a'' at 1..2 expected non-zero digit, ''0'', or ''['',
        found ''b'' at 6..7 expected '','',
        found ''c'' at 9..10 expected non-zero digit, ''0'', or ''['',
        found '' '' at 28..29 expected '','',
        found ''f'' at 32..33 expected non-zero digit, ''0'', or ''['',
        found ''g'' at 37..38 expected '','', or '']'',
        found ''h'' at 40..41 expected end of input,
    ],
}
```

If we remove `c`, the output preserves all valid data despite the invalid input:

```
ast_parser.parse("[a 10 b, [ d 20 e, f 30 g] e, f 40 g] h") = ParseResult {
    output: Some(
        List(
            [
                Item("10",),
                List([Item("20",),Item("30",)],),
                Item("40",),
            ]
        ),
    ),
    errs: [
        found ''a'' at 1..2 expected non-zero digit, ''0'', or ''['',
        found ''b'' at 6..7 expected '','',
        found ''d'' at 11..12 expected non-zero digit, ''0'', or ''['',
        found ''e'' at 16..17 expected '','',
        found ''f'' at 19..20 expected non-zero digit, ''0'', or ''['',
        found ''g'' at 24..25 expected '','', or '']'',
        found ''e'' at 27..28 expected '','',
        found ''f'' at 30..31 expected non-zero digit, ''0'', or ''['',
        found ''g'' at 35..36 expected '','', or '']'',
        found ''h'' at 38..39 expected end of input,
    ],
}
```

## Wrapping Up

You've reached the end of the post. It took me some effort to write, and I hope it was interesting and maybe even useful. Thank you very much for your attention.

I would have been really glad to find something like this when I decided to implement error recovery in my parser.

## Discussion

Join the discussion on [Reddit](https://www.reddit.com/r/rust/comments/1nl03yl/chumsky_parser_recovery/).