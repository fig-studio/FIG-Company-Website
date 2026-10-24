# Partner / backer logos

PNG (or SVG) files for the "Backed by & building with" marquee in
index.html, one file per name currently rendered as text there:

- [x] aws.png
- [x] stripe.png
- [x] 500-global.png
- [x] plug-and-play.png
- [x] nebius.png
- [x] pixverse.png
- [x] sixty-degree-capital.png
- [x] acorn-pacific-venture.png
- [x] hat-trick-capital.png
- [x] embedding-vc.png

Once all ten are in place, the marquee markup swaps each `<span>NAME</span>`
for `<span><img src="logos/NAME.png" alt="NAME"></span>`.

## Partner deck (`partners/fig-studio-partner-deck.html`)

The deck's partner slide also uses:

- `lenovo.svg`, `nvidia-mark.svg`: from the simple-icons package (CC0), viewBox cropped to the artwork. The NVIDIA file is the eye mark only; the deck sets the word "NVIDIA" next to it.
- `alumni-ventures.png`, `stanford.png`: not in the repo yet. Until they are, the deck shows the name as text. Add a file with exactly that name and the logo appears; no code change needed.

Every logo on that slide is shown in greyscale so mixed files read as one set.
