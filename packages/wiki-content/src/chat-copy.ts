/**
 * Wiki-host chat copy shared by the Next.js and Vite readers. Lives here —
 * not in @oncobase/chat, whose boundary test keeps it site-agnostic — so the
 * two hosts cannot drift (emoji badges, prompt wording, prompt count).
 * Structurally compatible with @oncobase/chat's ChatCopy.
 */
export const wikiChatCopy = {
  emptyStateTitle: "What questions do you have?",
  emptyStateDescription: "",
  suggestedPrompts: [
    { badge: "\u{1F48A}", label: "When does AC chemo start, and how long is the immune-suppression window after the last cycle?" },
    { badge: "\u{1F9EC}", label: "What's the optimal timing to start a personalized mRNA neoantigen vaccine relative to AC and pembrolizumab?" },
    { badge: "\u{1F9EA}", label: "Which mRNA vaccine trials (Moderna mRNA-4157, BNT122) are currently enrolling for TNBC, and when would the patient be eligible?" },
    { badge: "\u{1F4CA}", label: "How does ctDNA clearance timing during NACT predict pCR and inform vaccine sequencing?" },
    { badge: "\u23F1\uFE0F", label: "When should immune reconstitution be confirmed before starting neoantigen vaccination?" },
  ],
  promptPlaceholder: "Ask a question...",
};
