# Bundled locale fonts

Noto Sans Arabic and Noto Sans TC are distributed under the accompanying SIL Open Font License. The WOFF2 files preserve the complete upstream variable fonts and glyph coverage.

- Arabic: https://github.com/google/fonts/tree/main/ofl/notosansarabic
- Taiwan Traditional Chinese: https://github.com/google/fonts/tree/main/ofl/notosanstc

Upstream TTF SHA-256:

- Noto Sans Arabic: `63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e`
- Noto Sans TC: `864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`

WOFF2 SHA-256:

- Arabic: `7afcb81725bda4e53b23cea31c0c3692fd9bc7ee95ae3f49b5eba22f2d26c489`
- Taiwan: `2dd1f8915b88a9ded79d37d72eebe63f01bac9573d10256d092c3aed3cf6d42c`

`NotoSansTC-ui.woff2` is a FontTools subset of the same upstream variable font containing the six characters in the native language label `繁體中文 (台灣)`. Its SHA-256 is `60a605fc5f1685653430f5ac86cc52bebc7e859d5194a18d64346caa69a4f21a`. CSS loads this small face for the label; translated content uses the complete font. The same accompanying license applies.
