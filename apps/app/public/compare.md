# How Oncobase compares

Most people don’t need to build anything. Start with the simplest tool that does the job, and reach for Oncobase when you want a private, shareable knowledge base you control, or you’re building your own.

We make Oncobase, so we’re not neutral. What we say about other products comes from their own sites and repositories as of October 2026. Check before you decide, and tell us what we got wrong.

Not sure? Start with Notion to share with family today, or Obsidian to keep everything private on your own computer. If you want help researching your case, look at Yuga Bio. Come back if you outgrow them.

Page: https://diana-tnbc.com/compare. Source: https://github.com/jasonLaster/oncobase. Agent-readable feature list: https://diana-tnbc.com/features.md.

## Which should I use?

- **Keep notes and share them with my family:** start with Notion (also consider Obsidian). Notion is the quickest way to get everyone on the same page, with sharing built in. Move to Oncobase if different people should see different pages, or names should be hidden inside a page.
- **Keep everything private on my own computer:** start with Obsidian (also consider Notion). Obsidian keeps plain markdown files on your device, free, with paid encrypted sync if you want it. Oncobase publishes an Obsidian-style folder, so you can start in Obsidian and add a private reader later.
- **Turn my records into research and trial matches:** start with Yuga Bio (also consider Citizen Health). Yuga Bio is built for this: records in, a structured case file and trial search out. Add Oncobase when you want a lasting, shareable knowledge base you control alongside the research.
- **Collect records from all my providers:** start with Citizen Health (also consider Mere Medical). Citizen Health retrieves records for you. Mere Medical does it on your own server if you prefer self-hosting. Oncobase organizes what you gather into notes, papers, and results people can read.
- **Give my family and care team a private, searchable knowledge base:** start with Oncobase (also consider Notion, Yuga Bio). This is what Oncobase is for: roles, sensitive pages, inline redaction, chat and semantic search, and scan and slide viewers. It asks more of you than Notion or Yuga Bio. If you only need notes or research, start there.
- **I’m building my own product:** start with Oncobase (also consider Medplum, Mere Medical). Oncobase is MIT licensed, so you can reuse the reader, tables, chat, comments, and viewers. Medplum covers the clinical data layer, and Mere Medical covers pulling records from portals. Have your agent read /features.md first. It lists every feature and interface.

## Side by side

| Question | Oncobase | Notion | Obsidian | Yuga Bio | Citizen Health | Mere Medical | Medplum |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Where your data lives | Your accounts or server | Hosted | Your device | Hosted | Hosted | Your server | Managed or self-hosted |
| Open source | Yes (MIT) | No | No (open file format) | No | Not stated | Yes (MIT) | Yes (Apache 2.0) |
| Cost | Free; you pay for hosting | Free and paid tiers | Free app; paid Sync and Publish | $20–$100 a month, plus custom | Free in early access | Self-host | Free core; paid hosting |
| Bring in medical records | Bring your files; optional Epic labs | Paste or attach | Paste or attach | Upload documents and genomics | Retrieves from providers | Syncs from patient portals | You build it (FHIR) |
| AI over your content | Chat agent and semantic search | Notion AI | Through plugins | Agents research your case | AI companion | Not stated | Not stated |
| Trial and literature search | CLI helpers for literature and trials | Not built in | Not built in | 13 registries and open literature | Not stated | Not stated | You build it |
| Share with family and the care team | Roles by folder and tag, plus comments | Sharing and permissions | Shared vaults | Shared workspace | Not stated | Not stated | You build it |
| Hide names inside a page | Inline redaction wherever text leaves | Not built in | Not built in | De-identifies uploads | Not stated | Not stated | Not stated |
| Scan and slide viewers | DICOM and pathology viewers | Not built in | Not built in | Not stated | Not stated | Not stated | Not stated |
| Compliance statements | None; you own how it’s hosted | BAA on Enterprise plan | Not stated | BAA for providers and custom plans | SOC 2 Type II | Not stated | HIPAA and SOC 2 (managed) |
| Open interfaces for your own tools | CLI, JSON API, and /features.md | API | Plugin API | Not stated | Not stated | Open source code | FHIR API and SDK |

"Not stated" means the product's public site or repository doesn't say.

## Each option

### Notion

Shared workspace. An all-in-one workspace for docs, databases, and projects, with AI and sharing built in. https://www.notion.com/

- **Great at:** Quick to start and easy to share with family. Databases work well for appointments, medications, and questions for the care team.
- **Consider:** It isn’t built for medical records. Notion signs a HIPAA business associate agreement only on its Enterprise plan, so check its terms before storing anything sensitive.

### Obsidian

Private notes. Notes as plain markdown files on your device, with optional paid sync and publishing. https://obsidian.md/

- **Great at:** Your notes stay yours, in an open file format. The app is free, Sync is end-to-end encrypted, shared vaults let you collaborate, and community plugins fill gaps.
- **Consider:** You run it yourself. A read-only site for family, roles, search by meaning, and redaction need plugins or something built on top. Oncobase publishes an Obsidian-style folder of markdown, so the two work together.

### Yuga Bio

Hosted AI research workspace. Upload your records and AI agents research trials, literature, and molecular context for your case. https://yugabio.com/

- **Great at:** Turns records into a structured case file, searches open biomedical literature, and searches 13 trial registries. It de-identifies uploads before its AI sees them, says it doesn’t train on your data, and lets you invite others into a shared workspace.
- **Consider:** It’s a hosted, proprietary service with paid plans ($20, $50, and $100 a month, plus custom), offered to people in the United States. A business associate agreement covers providers and custom plans.

### Citizen Health

Records plus an AI companion. Gathers records from your providers and adds an AI companion that answers questions and handles paperwork. https://www.citizen.health/

- **Great at:** Centralizes records from many providers, tracks symptoms, and drafts insurance appeals, forms, and scheduling with your approval. It cites SOC 2 Type II.
- **Consider:** Free in early access, with pricing still to come, and a proprietary service. It serves rare and complex conditions as well as cancer.

### Mere Medical

Self-hosted records. An open-source, self-hosted app that pulls your records from patient portals into one timeline. https://github.com/cfu288/mere-medical

- **Great at:** Syncs records from the patient portals of thousands of hospitals and clinics onto a server you run, so they stay in your hands. MIT licensed.
- **Consider:** Maintained by one developer, and it’s a records tool, not a notes or research workspace.

### Medplum

Developer platform. An open-source (Apache 2.0) platform for building clinical software on FHIR. https://www.medplum.com/

- **Great at:** A serious foundation if you’re building a product: FHIR-native storage, an API, authentication, automation, and managed hosting. Its site cites HIPAA and SOC 2 compliance.
- **Consider:** It’s infrastructure for builders, not an app a family can use on its own.

### Oncobase

Open-source knowledge base. An open-source knowledge base for taking control of your care. https://github.com/jasonLaster/oncobase

- **Great at:** Publishes a vault of notes, papers, and results to a searchable reader with chat, semantic search, roles, inline redaction, comments, and scan and slide viewers. MIT licensed, with a CLI and files built for agents.
- **Consider:** You set it up and host it, or have your agent do it. It organizes what you bring and can import labs from Epic MyChart, but it doesn’t gather your records or match trials for you. It carries no compliance certification, so you own how it’s hosted.

## If you're building your own

Oncobase is MIT licensed, so a family or a company can reuse it, and an agent can read /features.md to see everything it offers. If you handle other people's health information, check which rules apply to you: Oncobase carries no compliance certification.

### Reusable code in Oncobase

Only the CLI is on npm. The rest lives under `packages/` in the repository.

| Piece | License | What you get |
| --- | --- | --- |
| [@oncobase/smart-table](https://github.com/jasonLaster/oncobase/tree/main/packages/smart-table) | MIT | Tables that size columns to their content, with resize handles and expand-to-fill. |
| [@oncobase/wiki-markdown](https://github.com/jasonLaster/oncobase/tree/main/packages/wiki-markdown) | MIT | A markdown renderer with wikilinks, citations, math, Mermaid, and the smart tables. |
| [@oncobase/wiki-shell](https://github.com/jasonLaster/oncobase/tree/main/packages/wiki-shell) | MIT | The reader’s navigation, header, outline, search, and layout pieces. |
| [@oncobase/chat](https://github.com/jasonLaster/oncobase/tree/main/packages/chat) | MIT | A full-stack chat UI with streaming and saved conversations. |
| [@oncobase/wiki-comments](https://github.com/jasonLaster/oncobase/tree/main/packages/wiki-comments) | MIT | Comment threads on pages and selections, built on Liveblocks. |
| [@oncobase/diagnostics](https://github.com/jasonLaster/oncobase/tree/main/packages/diagnostics) | MIT | The diagnostics timeline and study helpers. The scan and slide viewers live in the app. |
| [@oncobase/wiki-content](https://github.com/jasonLaster/oncobase/tree/main/packages/wiki-content) | MIT | Content contracts, privacy helpers for hiding personal details, and embeddings. |
| [@oncobase/oncobase (CLI)](https://www.npmjs.com/package/@oncobase/oncobase) | MIT | Check, sync, and publish a vault in a few commands. The one package on npm. |

### Other open-source projects worth building on

| Piece | License | What you get |
| --- | --- | --- |
| [Medplum](https://github.com/medplum/medplum) | Apache 2.0 | FHIR-native storage, authentication, an API, and automation for clinical software. |
| [Mere Medical](https://github.com/cfu288/mere-medical) | MIT | Pulls records from patient portals into a self-hosted timeline. |
| [Cornerstone3D](https://github.com/cornerstonejs/cornerstone3D) | MIT | The DICOM imaging engine behind Oncobase’s scan viewer. |
| [OpenSeadragon](https://github.com/openseadragon/openseadragon) | BSD 3-Clause | The zoomable image viewer behind Oncobase’s whole-slide pathology viewer. |

## Also worth knowing

- [osteosarc.com](https://osteosarc.com/): Sid Sijbrandij’s openly shared tumor genomics, imaging, and timeline data. It inspired Oncobase, and shows what sharing your own data openly can look like.
- [OnCo technologies](https://onco.cc/technologies/): A browsable catalog of 765 cancer technologies. A reference for what exists, to use alongside any of the above.
- [Healthier Intelligence](https://www.healthier.inc/): Early: its site shows a tagline and a contact address and no product details yet, so there is nothing to compare.
- [Fasten Health](https://github.com/fastenhealth/fasten-onprem): A self-hosted family record manager (GPL-3.0). Its on-premise repository is archived and read-only, and it supported manual entry and FHIR uploads rather than syncing from providers. Mere Medical is the active alternative.

## Sources

- [Notion HIPAA guidance](https://www.notion.com/help/hipaa)
- [Yuga Bio](https://yugabio.com/)
- [Citizen Health](https://www.citizen.health/)
- [Obsidian](https://obsidian.md/)
- [Mere Medical README](https://github.com/cfu288/mere-medical)
- [Medplum](https://www.medplum.com/)

Checked October 2026.
