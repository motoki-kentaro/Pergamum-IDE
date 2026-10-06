# Third Party Notices

This file aggregates attribution and license information for the third-party
material bundled with Pergamum that is maintained by hand. It covers:

- Feather icons
- Ionicons icons
- Codicons icons
- SVG Repo icons
- Typewriter sounds
- x0213.org Character Mapping Data
- Aozora / accent decomposition conversion table
- KaTeX fonts
- kuromoji dictionary data (mecab-ipadic)

The licenses of the npm packages distributed with Pergamum (the production
dependency closure, including highlight.js, mermaid, KaTeX, textlint and
kuromoji) and of the Electron runtime are listed in
[`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md). That file is generated
from `package-lock.json` and `node_modules` by
`npm run generate:third-party-licenses`; do not edit it by hand.

## Feather icons

Pergamum includes selected SVG icons from Feather.

- Project: Feather
- Copyright: (c) 2013-2023 Cole Bemis
- Source: <https://github.com/feathericons/feather>
- License: MIT
- License text: `assets/icons/feather/LICENSE.txt`

Modifications:

- selected SVG files were copied into Pergamum's asset tree
  (`assets/icons/feather/`)
- file names and paths may have been changed to match Pergamum conventions
- icons may be styled by CSS, including size and color
- SVG path data is otherwise unmodified unless noted in commit history

## Ionicons icons

Pergamum includes selected SVG icons from Ionicons.

- Project: Ionicons
- Copyright: (c) 2015-present Ionic (<http://ionic.io/>)
- Source: <https://github.com/ionic-team/ionicons>
- License: MIT
- License text: `assets/icons/ionicons/LICENSE.txt`

Modifications:

- selected SVG files were copied into Pergamum's asset tree
  (`assets/icons/ionicons/`)
- file names and paths may have been changed to match Pergamum conventions
- icons may be styled by CSS, including size and color
- SVG path data is otherwise unmodified unless noted in commit history

## Codicons

Pergamum includes selected SVG icons from Codicons.

- Project: Codicons
- Copyright: Microsoft Corporation and contributors
- Source: <https://github.com/microsoft/vscode-codicons>
- License: Creative Commons Attribution 4.0 International Public License
- License text: `assets/icons/codicons/LICENSE`

Codicons states that Microsoft and contributors license documentation and other content in the repository under the Creative Commons Attribution 4.0 International Public License, and code under the MIT License.

Pergamum uses selected SVG icon assets from Codicons.

Modifications:

- selected SVG files were copied into Pergamum's asset tree
- file names and paths may have been changed to match Pergamum conventions
- icons may be styled by CSS, including size and color
- SVG path data is otherwise unmodified unless noted in commit history

No endorsement by Microsoft is implied. Microsoft, Visual Studio Code, VS Code, Windows, and related names or marks are trademarks or registered trademarks of Microsoft Corporation.

## SVG Repo icons

Pergamum includes selected SVG icons obtained from SVG Repo.

SVG Repo hosts icons under multiple licenses. Each imported SVG Repo icon is tracked with its original page and license.

See: `assets/icons/svgrepo/SOURCES.md`

## Typewriter sounds

Pergamum includes typewriter sound effects obtained from OpenGameArt.

- Source: OpenGameArt - Typewriter sounds
- Author: Cassie-OrbitGames
- URL: <https://opengameart.org/content/typewriter-sounds>
- License: CC0
- License checked: 2026-08-22
- Details: `assets/sounds/README.md`

Included files:

- `typewriter1.wav`
- `typewriter2.wav`
- `typewriter3.wav`
- `typewriter4.wav`
- `typewriter5.wav`
- `typewriter6.wav`
- `typewriter7.wav`
- `typewriter8.wav`

Pergamum usage:

- newline sound: `typewriter8.wav`
- keypress sound: `typewriter1.wav`, `typewriter2.wav`, `typewriter3.wav`, `typewriter4.wav`, `typewriter5.wav`, `typewriter6.wav`, `typewriter7.wav`

CC0 does not require attribution as a license condition, but Pergamum records this source for traceability.

## x0213.org Character Mapping Data

Pergamum includes a generated character mapping dataset derived from reference data published by x0213.org.

The generated dataset is used by Pergamum's Aozora Bunko-like preview renderer to map JIS X 0213 men-ku-ten codes to Unicode strings for supported gaiji replacement.

Included materials may include:

- the original reference text obtained from x0213.org
- conversion scripts used to generate Pergamum's JSON mapping data
- generated JSON mapping data for use by Pergamum

Pergamum gratefully acknowledges x0213.org for publishing and maintaining the reference data that made this functionality possible.

The generated mapping data represents factual character-code mapping information. Pergamum does not claim copyright over the original x0213.org reference data.

## Aozora / accent decomposition conversion table

Pergamum includes a derived mapping table for accent-decomposed Latin text used when rendering Aozora-style text.

Primary source:
アクセント付き文字の変換表 0.11
<https://cosmoshouse.com/tools/acc-conv-j.htm>

Aozora usage reference:
青空文庫テキストへの「アクセント分解」の適用
<https://www.aozora.gr.jp/accent_separation.html>

The table is used to convert Aozora-style accent-decomposed Latin notation inside 〔...〕 into Unicode characters for rendering.

## KaTeX fonts

KaTeX consists of two separately licensed parts that Pergamum distributes:

- **KaTeX package / source code** (the `katex` npm package's JavaScript and
  CSS): MIT License. Its license text is in the `katex` entry of
  [`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md).
- **KaTeX font files** (`dist/fonts/KaTeX_*.ttf`, `.woff`, `.woff2` of the
  `katex` package): SIL Open Font License, Version 1.1. Pergamum bundles them
  for math rendering in Markdown Preview and embeds the `.woff2` files in
  exported HTML.

The font license is stated by the font files themselves. Every distributed
KaTeX font file (20 `.ttf`, 20 `.woff` and 20 `.woff2` files in `katex`
0.19.0) carries the following copyright and license description in its
embedded `name` table, differing only in the Reserved Font Name:

```text
Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)
Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>),
with Reserved Font Name KaTeX_<Family>.

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license available with a FAQ at:
http://scripts.sil.org/OFL
```

Reserved Font Names: `KaTeX_AMS`, `KaTeX_Caligraphic`, `KaTeX_Fraktur`,
`KaTeX_Main`, `KaTeX_Math`, `KaTeX_SansSerif`, `KaTeX_Script`, `KaTeX_Size1`,
`KaTeX_Size2`, `KaTeX_Size3`, `KaTeX_Size4`, `KaTeX_Typewriter`.

The npm package does not include the OFL text. It is reproduced below from the
SIL Open Font License, Version 1.1 as published at
<https://openfontlicense.org/documents/OFL.txt> (the license body from the
"SIL OPEN FONT LICENSE Version 1.1" heading onward, without the template
copyright header; retrieved 2026-10-06, SHA-256 of the retrieved file
`1d361a8f8e8ce6e68457dcd93fb56e162e6baa3bbb7e7573a290d44399f6b57e`). This file
is maintained by hand and is not produced by the license generator.

```text
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## kuromoji dictionary data (mecab-ipadic)

The Japanese linter uses kuromoji, whose dictionary files (`dict/*.dat.gz`)
are distributed with Pergamum and read at runtime. The kuromoji code is
licensed under Apache-2.0; the dictionary data is derived from
mecab-ipadic-2.7.0-20070801 and is under a separate license:

- Copyright 2000, 2001, 2002, 2003 Nara Institute of Science and Technology
  (NAIST). All Rights Reserved.
- A large portion of the dictionary entries originate from ICOT Free Software;
  the ICOT Free Software conditions, including its "NO WARRANTY" section, apply
  to the dictionary as well.

The complete mecab-ipadic copyright and license text, which must accompany any
copy of the dictionary, is reproduced verbatim from kuromoji's `NOTICE.md` in
the `kuromoji@0.1.2` entry of [`THIRD_PARTY_LICENSES.md`](./THIRD_PARTY_LICENSES.md).
That text matches the `COPYING` file of mecab-ipadic upstream
(<https://github.com/taku910/mecab/tree/master/mecab-ipadic>).
