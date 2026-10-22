# What we learned from products like Reinvent (Oct 2026)

Sources: REA (Reverse Engineer Anything) runs on GitHub's runner (summaries in
`rea/out/`), plus web research on concept feeds, discovery apps, AI design
tools and sourcing tools.

## REA teardown (8 of 10 sites captured)

Product Hunt and Kickstarter answered with Cloudflare bot challenges, so REA saw
only the challenge page for those two.

| Site | What REA saw | Takeaway for Reinvent |
|---|---|---|
| Yanko Design | WordPress, server-rendered list of articles, ads, analytics; headline + teaser + tags + date per post; no API calls from the page | Pure editorial feed: no save, no vote, no follow-up on a concept. Pretty renders, no feasibility or cost |
| Designboom, Core77 | WordPress page cache, heavy ad stacks (DoubleClick, funding choices), Clarity / GA | Same pattern; Core77 adds forums and awards |
| Pinterest (logged out) | 69 client routes incl. `/pin/:id/repin`; `BoardsFeedResource`, `UserExperienceResource`; Explore tabs and "Browse by category" | Saves to boards drive everything; editorial collections and category browsing |
| Behance | GraphQL API, about 1,460 JS modules (1.1 MB), Adobe push service worker | Heavy SPA; project pages are the unit |
| Accio (Alibaba) | Agent UI that shows "Thought for 96s", task list, agents and scheduled tasks; product images as 720 px WebP from Alibaba's CDN | Shows the agent's work openly; that builds trust |
| Vizcom | Webflow marketing site, HubSpot, Intercom | Pro tool (sketch to render), not a feed |
| Jungle Scout | 33 storage keys, Segment, Amplitude, feature flags | Score-driven product research for sellers |

Reinvent's own app is about 80 KB of JavaScript with no ads or trackers.
Competitors ship 0.2 to 1.1 MB plus ad stacks, so Reinvent should feel faster
on a phone.

## What we built from it

- Problem → fix line on every reinvention, one lever per inventor, feasibility
  score, metrics marked sourced or estimate, Google Patents search, numbered
  concept sheets, and a reviewer that sends back near-duplicates.
- "I'd buy this" with a price, and "Best fix?" picks. Demand feeds the agents.
- Make it: opportunity score with its working shown, an editable margin
  calculator, samples, tooling, ODM vs OEM, HTS code with an as-of date,
  factory vs trading company, tech pack, and an RFQ in English and Chinese.
- Work receipts (searches, pages read, minutes), in the spirit of Accio's
  "Thought for 96s".

## Good next steps (not built yet)

1. Boards for saves, plus "more like this" built from what people save together
   (Pinterest).
2. Browse by category or follow a category, with web push when a new round
   lands (works for home-screen apps since iOS 16.4).
3. A daily edition: a critic publishes only the best rounds, about 8 to 12 a
   day.
4. A shareable 2:3 before/after image for Pinterest and Stories.
5. A crowdfunding-ready one-pager built from the Make-it report.
6. Optional illustrative render from a free image service, clearly labelled.
