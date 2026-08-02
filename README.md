<div align="center">

# meet-utkarsh

**My entire internet presence, compressed into one terminal screen.**

[![npm package](https://img.shields.io/npm/v/meet-utkarsh?color=blue&style=flat-square)](https://www.npmjs.com/package/meet-utkarsh)
[![Node.js Version](https://img.shields.io/node/v/meet-utkarsh?style=flat-square)](https://nodejs.org)

No website, no image CDN, no gimmick page — just a card that renders itself in your terminal, line by line, with a face, a résumé, and links you can actually click.

```bash
npx meet-utkarsh
```

</div>

---

### The Pitch

Run the command and watch a terminal window titled `@4-thkind/info` assemble itself. 

The photo of me wipes down the screen in strips. Beside it, a text panel builds itself out of the facts that matter: where I study, my CGPA, the stack I work in, the paper that got accepted to ICML 2026, a hackathon I over-performed at, and the open-source programs I've contributed to.

When the card is done, a fake shell prompt blinks at the bottom. And then the portfolio URL starts to fall apart — characters turning to noise — before re-assembling itself into the real address.

Every line in the Contact section is a live hyperlink. Cmd-click (or Ctrl-click) `github.com/4-thkind` and your browser opens GitHub. The email, the LinkedIn, the portfolio — all of it is clickable, straight from your terminal. No copy-paste required.

Then you hit any key, and it signs off with `later, space cadet ✦`.

---

### Why I built it

My portfolio URL lives on a Cloudflare Worker. I got tired of pointing people to a link and hoping they'd remember it. So I turned the intro into something that *runs* — a command they type once and can't forget, because it's doing its best to be a tiny interactive show.

---

### What the card contains

- **A real photo.** Not an emoji, not ASCII art. Actual pixels of my face, portrait-cropped so it fills the side panel without squeezing the text.
- **A résumé in plain text.** Institute, CGPA, tech stack, AI/ML focus, and cloud tools.
- **Highlights.** The ICML 2026 paper, ET GenAI Hackathon top performer, GSoC and SSoC contributor, Gemini certification.
- **Contact.** Email, GitHub, LinkedIn — all OSC 8 hyperlinks.
- **Portfolio.** The URL, glitch-revealed at the end.
- **A fake title bar.** A nod to the terminal frame, with a `+ = X` that deliberately does nothing.
- **A fake prompt.** `[from ashes i claim ~]$` — a one-line flourish. Don't try to type at it.

---

### Usage

```bash
# just run it
npx meet-utkarsh
```

---

### How it's built

Node ≥ 18.17, zero network calls, no image hosts, no analytics. The whole thing is TypeScript compiled to a single `dist/` that runs on a stock Node install.

### Development

```bash
npm install
npm run build   # tsc → dist/
npm run dev     # run from source with tsx
npm run start   # run the built version
```
