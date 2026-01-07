---
title: "Top CSS Battle solutions"
pubDate: 2026-01-07
description: "Decomposing top CSS Battle solutions"
---

I started doing [CSSBattle](https://cssbattle.dev/) challenges lately. I am not a CSS expert, but this is what makes these challenges interesting for me: I can learn something new while feeling entertained.

In this post I am going to go through several top CSS Battle solutions and see how they work.

## 06 January 2026

![cssbattle-2026-01-06.png](./cssbattle-2026-01-06.png)

The top solution is by user [Vegy](https://cssbattle.dev/player/cubachatou). It looks like this:
```html wrap=true
<dt><p><style>*{background:#F3EAD2;*{offset:ray(0deg);width:40;height:10lh;background:#C36768;border-block:5ch solid#243D}p{width:60;font:13q/0'
```

### border-block

```html
<dt>
<style>
    html {
        background:#F3EAD2;
    }
    dt {
        width:40;
        height:10lh;
        background:#C36768;
        border-block:5ch solid #243D
    }
```

I think `background`, `width` and `height` are obvious here. (`10lh` just means 10 line heights here.)

[`border-block`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/border-block) is a way specify `border`, just like `border-left` or `border-bottom`, but it specifies a border between the blocks, which by default means it specifies values for `border-bottom` and `border-top` simultaneusly. 

The color `#243D` is different from the color in the target image, which is `#38483C`. It has opacity, and when combined with the background color produces the required color. A neat trick that saves two characters.

`5ch` means 5 [widths of the glyph `0`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/length#ch).

This code produces this image:
![border-block.png](./border-block.png)

### offset: ray(0deg)

Let's add one more line (`offset: ray(0deg)`) from the original solution:
```html ins={7}
<dt>
<style>
    html {
        background:#F3EAD2;
    }
    dt {
        offset: ray(0deg);
        width:40;
        height:10lh;
        background:#C36768;
        border-block:5ch solid #243D
    }
```

Normally, [`offset`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/offset) property is used with animations and is a shorthand to set different `offset-` properties in one go. 

The only specified values sets the `offset-path` property, which defines the path the element will move along when animated. `ray(0deg)` uses the [`ray`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/ray) function to specify it should move straight up. It turns out that to move up, the element has to be rotated 90 degrees CCW.

The value for the `offset-position` property is not specified and because of this it is set to `normal`, which means that the element is placed in the center of the parent element.

There is no animation specified, so the element is positioned as for the first frame of animation.

The html above is rendered like this:
![(offset-ray.png)](offset-ray.png)

### Making a cross

Let's just apply the style for the `dt` element also to the `body`:

```html {6}
<dt>
<style>
    html {
        background:#F3EAD2;
    }
    body, dt {
        offset: ray(0deg);
        width:40;
        height:10lh;
        background:#C36768;
        border-block:5ch solid #243D
    }
```

Yes, body is actually the normal element that behaves just like any other element. What do we get now is just this: `body` and `dt` look exactly the same: as a vertical rectangle with squares of different color on the ends. `body` is centered inside the `html` element and rotated to make it horizontal. `dt` is centered inside the body, and rotated again, so it now appears vertical.

It looks like this:
![(cross.png)](cross.png)

### Adding the central part

In the target image, there is a square in the center let's add `p` element and style it to produce that central element.

```html ins={2,14-20}
<dt>
<p>
<style>
    html {
        background:#F3EAD2;
    }
    body, dt {
        offset: ray(0deg);
        width:40;
        height:10lh;
        background:#C36768;
        border-block:5ch solid #243D
    }
    p {
        offset: ray(0deg);
        width:60;
        height:0;
        background:#C36768;
        border-block:30px solid #243D
    }
```

This new `p` element is very similar to the `body` and `dt` elements. We have only changed it dimensions so central part disappeared and squares at the end together appear as one square of size 60x60.

This renders the image that is similar with the target image:
![cssbattle-2026-01-06.png](./cssbattle-2026-01-06.png)

### Finishing touches

We can reuse the `body, dt`  style for the `p` element as it is very similar. We can take advantage of `height: 10lh` (means 10 line heights) and `border-block:5ch` (means border width equals to 5 `0` characters widths), and change the `font` property for the `p` element.

```html
<dt>
<p>
<style>
    html {
        background:#F3EAD2;
    }
    body, dt {
        offset: ray(0deg);
        width:40;
        height:10lh;
        background:#C36768;
        border-block:5ch solid #243D
    }
    p {
        width:60;
        font:13q/0 ''
    }
```

With `font:13q/0 ''` we set the `font-size` property to `13q` (1Q = 1/40th of 1cm), `line-height` to `0` and `font-family` to empty string. `height:10lh` in combination `line-height:0` effectively sets `height` to `0`. As for the `font-size` it affects the `border-width` value as it is specified as `5ch`.

The last trick is to use `*` specifier and nesting to make our CSS even shorter.

```html
<dt>
<p>
<style>
    * {
        background: #f3ead2;
        * {
            offset: ray(0deg);
            width: 40;
            height: 10lh;
            background: #c36768;
            border-block: 5ch solid #243d;
            p {
                width: 60;
                font: 13Q/0 "";
            }
        }
    }
```

After removing the whitespace this code is equivalent to the top solution.

## 05 January 2025

![cssbattle-2026-01-05.png](./cssbattle-2026-01-05.png)

I do not have access to the top solutions for this day, but I saved one. Unfortunately, I do not know who the author is.

```html wrap=true
<StYle>*{background:conic-gradient(var(--b,#8647E6)75%,#EFEB99 0)4px 0/7em 85vw;*{margin:130 56 0;--b:#0000
```

This code does not introduce any new elements, and only uses `html` and `body` that are already present in the document.

### Conic gradient

Let's look at what is the `background` property does here:
```css
html {
    background: conic-gradient(#8647e6 75%, #efeb99 0);
}
```

This code sets the background image to conic gradient, that has two colors and a hard edge between them, one color covering the range from 0 to 75% of the full circle (or 270 degree) and the other covering the range from 75% (270 degree) to 0.

The resulting image looks like this:
![conic-gradient.png](./conic-gradient.png)


### Repeating the background

The [`background`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/background) property allows to specify not only the background image (conic gradient in our case), but also set values for `background-position` and `background-size`.
```css
html {
    background: conic-gradient(#8647e6 75%, #efeb99 0) 4px 0/7em 85vw;
}
```

Here we have set `background-position` to `4px 0` and `background-size` to `7em 85vw`. 

When the background image is smaller than the element it is tiled by default, and the result is this:

![conic-gradient-tiled.png](./conic-gradient-tiled.png)

### Applying the same background to body and positioning it

To achieve the final image, we can use the `body` element. 

Let's first position it and make it visible:
```css
html {
    background: conic-gradient(#8647e6 75%, #efeb99 0) 4px 0/7em 85vw;
}
body {
    background: red;
    margin: 130 56 0;
}
```

This will look like this:
![red-body.png](./red-body.png)

We can make the needed background with exactly the same trick as for the `html` element, just use fully transparent color instead of the color that covers 75% of the background image. This will create stripes that will make the image look exactly as needed. In the code below I made the stripes red instead of yellow, to make it easier to understand what is going on:

```css
html {
    background: conic-gradient(#8647e6 75%, #efeb99 0) 4px 0/7em 85vw;
}
body {
    background: conic-gradient(#0000 75%, red 0) 4px 0/7em 85vw;
    margin: 130 56 0;
}
```

![red-body.png](./red-body-stripes.png)

### Code reuse

Instead of specifying the gradient twice we can use css variables to change the color. The `var()` function takes variable name as the first parameter, but there is also the optional second parameter that takes the fallback value used in case the variable is not defined.

```css
html,
body {
    background: conic-gradient(var(--b, #8647e6) 75%, #efeb99 0) 4px 0/7em 85vw;
}
body {
    --b: #0000;
    margin: 130 56 0;
}
```

And finally, there is no need to use tag names, as we can use `*` and nesting:
```css
* {
    background: conic-gradient(var(--b, #8647e6) 75%, #efeb99 0) 4px 0/7em 85vw;
    * {
        --b: #0000;
        margin: 130 56 0;
    }
}
```

This code produces the desired image and after removing the whitespace is equivalent to the top solution.

![cssbattle-2026-01-05.png](./cssbattle-2026-01-05.png)

## Final words

It took more time than I expected to write this up. It was definitely interesting for me, and I would like to do something like this again. Hope that you also enjoyed reading this blog post.