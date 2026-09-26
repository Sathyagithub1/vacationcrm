# This vault

You maintain this vault. The owner drops raw material into `raw/` and asks
questions. Everything in `wiki/` is yours to write and keep correct.

The wiki is the primary artifact. `raw/` is an archive you can always re-read,
but nobody reads it day to day. If something matters, it has to end up on a
wiki page, in your own words, linked to everything related.

## Folders

```
raw/          source material, never edited after it lands
  assets/     images and attachments
wiki/
  sources/    one page per ingested item
  entities/   people, organisations, products, tools
  concepts/   ideas, methods, frameworks, arguments
  synthesis/  comparisons, themes, open questions
  index.md    catalog of every page
  log.md      chronological record of what you did
output/       reports, drafts, anything generated for use outside the vault
```

Never write to `raw/`. Never delete a wiki page without recording it in
`log.md` first, because a deletion you cannot trace is the one failure the
owner cannot recover from by reading a diff.

## Page contracts

Every page starts with frontmatter:

```yaml
---
title: Canonical name
type: source | entity | concept | synthesis
created: YYYY-MM-DD
updated: YYYY-MM-DD
aliases: [other names this is known by]
tags: [two or three, from the existing vocabulary]
---
```

**Source pages** record what one item said. Include the URL or file path, the
author, the date, and what it claims. Keep the claims attributable: this
source says X, not X is true. End with links to every concept and entity it
touches.

**Entity pages** describe a person, company, product or tool: what it is, why
it appears in this vault, and every source page that mentions it.

**Concept pages** are the ones that compound. One idea per page, explained in
plain language, with where it came from, what supports it, what argues against
it, and what is still unclear. A concept page written well is readable by
someone who has never seen the sources.

**Synthesis pages** exist only when they say something no single source did:
two sources disagree, three sources describe the same pattern, a question keeps
recurring. Do not write a synthesis page just to have one.

## Linking rules

Link the first mention of any concept or entity on every page, using
`[[wikilinks]]`. A page with no outbound links is a dead end and a page with no
inbound links is invisible, so at ingest time connect the new page to what is
already here before you finish.

If the target page does not exist yet, still write the link, then create the
page in the same run or add it to the gaps list in `index.md`. Links to pages
that will never exist are worse than no links.

Prefer a link over a restatement. If you find yourself explaining a concept
that already has a page, link it and move on.

## Handling disagreement

When a new source contradicts an existing page, do not overwrite. Record both
positions on the page, note which source says what and when, and mark the older
claim as superseded if the new source is clearly better evidence. Silent
overwrites destroy the one thing this vault has that a search engine does not:
the history of what the owner believed and why.

Never invent a fact to fill a gap. An explicit "not covered by any source here"
is useful. A plausible sentence with no source behind it poisons everything
downstream.

## Voice

Plain sentences. No marketing language, no hedging filler, no bullet lists
where a paragraph is clearer. Write for the owner in six months, who will not
remember the source at all.

## Logging

Append one line per operation to `log.md`:

```
2026-09-07 ingest raw/some-article.md -> 1 source, 3 concepts, 2 entities, 7 links
```

Keep `index.md` current in the same run. An index that lags behind is the
first sign the system is drifting.

## House rules (second-brain-kit)

These apply on top of everything above and win on conflict.

- **The wiki is memory, not live state.** A page that says what a config,
  table, server or integration holds is a dated snapshot. Before acting on it,
  check the live source of truth and update the page with what you found.
- **Secrets never enter the vault.** No API keys, tokens, passwords, connection
  strings or customer personal data in `raw/` or `wiki/`. Record where a secret
  lives ("in the server env as STRIPE_KEY"), never its value. Run the
  `second-brain-privacy` skill before any publish or share.
- **Proprietary logic stays private.** Scoring weights, prompts and pricing
  internals may be written here, but this folder must never be bundled, served
  or copied into a public build.
- **Nothing is deleted silently.** `raw/` is append-only. Wiki pages are merged
  or marked superseded, and every removal is logged in `log.md` first.
- **Ground every page in a real source.** No page is written from a name or a
  guess. If the source could not be read, say so on the page.
