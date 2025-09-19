---
title: "Parser recovery"
pubDate: 2025-09-18
description: "Parser recovery in **chumsky**"
draft: true
---

I have a project, that has a parser written using [chumsky](https://github.com/zesterer/chumsky).

Recently, I decided to add error recovery to the parser. And it took more time than I expected, mostly because of my misunderstanding of what it is and how it works. Now, when I figured it out, I cannot even remember what was the mental model I had about it.

## Single int

This code parses a single int-like string from the input:

```rs
use chumsky::{extra, prelude::*};

fn main() {
    let int_parser = text::int::<&str, extra::Err<Rich<char>>>(10)
        .padded();
    dbg!(int_parser.parser("100"))
}
```

We want our parser to recover from errors, so let's add some errors to the input. We want recoverable errors, so there should be something parse still.

### Extra characters before the valid input

One the possible errors is extra characters before the valid input:

```rs
    dbg!(int_parser.parse("abc 100"));
```

To deal with it we can add recovery to our parser:

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

It worked! We can see `Output(Some("100"))` in the result. The error is also reported. This is how error recovery is supposed to work: recover from errors, but still report them.

We added `.recover_with(skip_then_retry_until(any().ignored(), end()))`. What does it mean?

`recover_with` accepts a recovery strategy. It is called when the underlying parser failed.

`skip_then_retry_until(skip, until)` is a recovery strategy. `skip` and `until` are parsers. It works in a loop. It calls the `until` and `skip` parsers one time, then tries the original failed parser again. If `until` succeeds the recovery strategy fails and stops. If `skip` fails the recovery strategy also fails.

This way `recover_with(skip_then_retry_until(any().ignored(), end()))` means:

```
    while not reached end of the document:
        skip any character
        try original parser again (text::int in our case)
```

### Extra characters before the valid input

Another possible error is extra characters after the valid input.

```rs
    dbg!(int_parser.parse("100 abc"));
```

This is an error only because we are calling `parse` function. This function checks that the whole input was consumed by the parser. The parser itself happily stops, and if used with another parser, no error will be produced. For example this parser uses our int_parser and does not fail:

```rs
    assert!(!int_parser.then(ident()).parse("100 abc").has_errors());
```

But for the sake of completeness and to reiterate our understanding, let's recover from this error too. For this let's explicitly expect `end()` after the int and recover if that `end()` parser fails:

```rs
    let whole_string_int_parser = int_parser
        .then_ignore(end()
        .recover_with(skip_then_retry_until(any().ignored(), end())));
    dbg!(whole_string_int_parser.parse("100 abc"));
```

The output shows that this recovery strategy worked:

```
whole_string_int_parser.parse("100 abc") = ParseResult {
    output: Some("100"),
    errs: [
        found ''a'' at 4..5 expected end of input,
    ],
}
```

## Recover the list

Let's now extend our parser to accept a list of ints:

```rs
    let int_parser = text::int::<&str, extra::Err<Rich<char>>>(10)
        .padded()
        .recover_with(skip_then_retry_until(any().ignored(), end()));

    let int_list_parser = int_parser.separated_by(just(',')).collect::<Vec<_>>();

    dbg!(int_list_parser.parse("10, 20"));
    dbg!(int_list_parser.parse("a 10, a 20"));
```

Our recovery strategy still works, both calls to `parse` in the above code produced a list of `["10", "20"]`, and the errors were reported in the second case:

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

But what if we add invalid characters after the int:

```rs
    dbg!(int_list_parser.parse("10 abc, 20"));
```

In this example, fails the separator parser: `just(',')`. That is why our recovery did not help. Let's add recovery to that parser also:

```rs
    let int_list_parser = int_parser
        .separated_by(
            just(',').recover_with(skip_then_retry_until(any().ignored(), end()))
        )
        .collect::<Vec<_>>();
```

This recovery skips any characters until the end, checking original parser (`just(',')`) after each character. In our case, it skips "abc" and then comma is successfully parsed.

## Delimited list

Let's put our list into brackets:

```rs
    let int_list_parser = int_parser
        .separated_by(
            just(',').recover_with(skip_then_retry_until(any().ignored(), end()))
        )
        .collect::<Vec<_>>()
        .delimited_by(just('['), just(']'))
        .padded();

    dbg!(int_list_parser.parse("[10 abc, 20]"));
```

First thing is that we do not want our recovery for the comma to go outside the delimiter:

```rs
        .separated_by(
            just(',').recover_with(skip_then_retry_until(any().ignored(), just(']').ignored())),
        )
```

Now let's put our invalid characters before the closing bracket:

```rs
    dbg!(int_list_parser.parse("[10, 20 abc]"));
```

This parser fails to recover, because fails the parsing of the closing bracket. Let's add recovery to that parser:

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

The output shows that we successfully recovered all the invalid input:

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

## Recursive delimited list

Let's now allow our list to contain another lists:

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

Note the commented out recovery on `int_parser`. I commented it out, because it breaks the `choice` parser.

How does the `choice` parser works? It tries parsers from the list, until one of the parsers succeeds. With recovery, our `int_parser` succeeds even if it is not supposed to. In this example, it happily consumes `"[10` producing `Ast::Item(10)` and an error. The parser never enters state where it parses a list.

How do we fix this? The most logical thing to do is to reattach this recovery to `choice`. Also, we can move `padded` there too:
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

The resulting parser successfully parser inputs with various invalid sequences inside:
```
    dbg!(ast_parser.parse("a 10"));
    dbg!(ast_parser.parse("[a 10 b, c [20, 30] e]"));
    dbg!(ast_parser.parse("[a 10 b, [a 20 b, c 30 d]]"));
```

All of the examples above produce the expected AST and report errors. But there is a case where parsing fails:
```
    dbg!(ast_parser.parse("[10, a [b 20, 30], 40]"));
```
The output:
```
ast_parser.parse("[10, a [b 20, 30], 40]") = ParseResult {
    output: None,
    errs: [
        found ''a'' at 5..6 expected non-zero digit, ''0'', or ''['',
        found '','' at 17..18 expected end of input,
    ],
}
```

What is going on here? The last error message `found '','' at 17..18 expected end of input` tells us that it successfully parsed till the last closing bracked, but expected the input to end there. Here is my theory: it encounters `a`, the `choice` parser fails, the recovery kiks in and skips until `20` which is parsed as the the item of the outer list. 

We can repeat the trick with used for the `whole_str_int_parser` to recover from the last error:
```rs
    let ast_parser = recursive(|ast_parser| {
        ...
    })
    .then_ignore(end().recover_with(skip_then_retry_until(any().ignored(), end())));
```

And now the output is this, which supports my theory:
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

It is unfortunate, but I think chumsky does not allow recursive recovery. I am not sure about that, but that's how it looks like for me now. If that was not the case it would not skip to `20`, but will instead when trying `choice` at `[b 20...` it will try to parse list, find error inside but recover and that would result in much better result.

With that the only think I can come up with is this:
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

This means: before trying recovery with `skip_then_retry_until`, try another recovery strategy:
```rs
            .recover_with(via_parser(
                none_of(",[")
                    .repeated()
                    .ignore_then(nested_delimiters('[', ']', [], |_| Ast::Error)),
            ))
```

Here, `via_parser` is a recovery strategy that succeeds if the passed parser succeeds. The parser inside skips any character until comma or opening bracket, and then tries to skip nested brackets entirely. This way this strategy will fail if there is no opening bracket before the next comma, and if it is there it will skip the whole list.

`via_parser` startegy never retries the original parser, but the recovery strategy has to return the same type as the original parser, so I had to introduce new `Ast` variant.

The final code is like this:
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

It's output is like this:
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

If we remove the `c` the output preserves all of the data despite all the invalid input:
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

## Thank you

You've got to the end of the post. It took me some effort to write it, and I hope it was interesting and maybe even useful. Thank you very much for your attention.

I myself, would be really glad to find something like this when I decided to implement error recovery in my parser.