import type { DocContent } from "./types";

// /r/demo: a room that needs no backend, so the workspace can be tried (and shown) anywhere.
// Realtime still connects when Supabase is configured, so two browsers on /r/demo see each other.

export const DEMO_ROOM_ID = "demo";

const para = (id: number, text: string, tag = "p") => `<${tag} data-block="b${id}">${text}</${tag}>`;

const federalist = [
  para(0, "The Union as a Safeguard Against Domestic Faction", "h2"),
  para(
    1,
    "Among the numerous advantages promised by a well-constructed Union, none deserves to be more accurately developed than its tendency to break and control the violence of faction. The friend of popular governments never finds himself so much alarmed for their character and fate, as when he contemplates their propensity to this dangerous vice.",
  ),
  para(
    2,
    "By a faction, I understand a number of citizens, whether amounting to a majority or a minority of the whole, who are united and actuated by some common impulse of passion, or of interest, adverse to the rights of other citizens, or to the permanent and aggregate interests of the community.",
  ),
  para(3, "Two methods of curing the mischiefs", "h3"),
  para(
    4,
    "There are two methods of curing the mischiefs of faction: the one, by removing its causes; the other, by controlling its effects. There are again two methods of removing the causes of faction: the one, by destroying the liberty which is essential to its existence; the other, by giving to every citizen the same opinions, the same passions, and the same interests.",
  ),
  para(
    5,
    "It could never be more truly said than of the first remedy, that it was worse than the disease. Liberty is to faction what air is to fire, an aliment without which it instantly expires.",
  ),
  para(
    6,
    "The latent causes of faction are thus sown in the nature of man; and we see them everywhere brought into different degrees of activity, according to the different circumstances of civil society.",
  ),
  para(7, "Controlling the effects", "h3"),
  para(
    8,
    "The inference to which we are brought is, that the causes of faction cannot be removed, and that relief is only to be sought in the means of controlling its effects.",
  ),
  para(
    9,
    "A republic, by which I mean a government in which the scheme of representation takes place, opens a different prospect, and promises the cure for which we are seeking. The two great points of difference between a democracy and a republic are: first, the delegation of the government, in the latter, to a small number of citizens elected by the rest; secondly, the greater number of citizens, and greater sphere of country, over which the latter may be extended.",
  ),
  para(
    10,
    "Extend the sphere, and you take in a greater variety of parties and interests; you make it less probable that a majority of the whole will have a common motive to invade the rights of other citizens.",
  ),
  para(
    11,
    "In the extent and proper structure of the Union, therefore, we behold a republican remedy for the diseases most incident to republican government.",
  ),
].join("");

const attention = [
  para(0, "Reading notes: attention in sequence models", "h2"),
  para(
    1,
    "These notes walk through why attention replaced recurrence as the default way to model sequences, written for a study group reading the original transformer paper together.",
  ),
  para(2, "The problem with recurrence", "h3"),
  para(
    3,
    "Recurrent networks read a sentence one token at a time, carrying a hidden state forward. That makes training slow, because step ten can't start until step nine finishes, and it makes long-range links fragile, because information has to survive every step in between.",
  ),
  para(4, "Attention in one paragraph", "h3"),
  para(
    5,
    "Attention lets every token look at every other token directly. Each token produces a query, a key and a value. A token's output is a weighted average of all the values, where the weights come from how well its query matches each key.",
  ),
  para(
    6,
    "Because every pair is compared at once, the whole sequence is processed in parallel, and the path between any two tokens is a single step long.",
  ),
  para(7, "Multi-head attention", "h3"),
  para(
    8,
    "Instead of one attention pattern, the model learns several in parallel, called heads. One head might track which noun a pronoun refers to while another follows sentence structure. Their outputs are joined and mixed by a final projection.",
  ),
  para(9, "Position", "h3"),
  para(
    10,
    "Attention by itself ignores word order, so the model adds a positional signal to each token's embedding. The original paper used sine and cosine waves of different frequencies, which let the model reason about relative distance.",
  ),
  para(11, "Questions for the group", "h3"),
  para(
    12,
    "Why does attention cost grow with the square of the sequence length, and what have later models done about it?",
    "li",
  ),
  para(
    13,
    "Is a single-step path between tokens enough to explain why transformers handle long documents better?",
    "li",
  ),
].join("");

const at = "2026-10-30T10:00:00.000Z";

export const DEMO_DOCS: DocContent[] = [
  {
    id: DEMO_ROOM_ID,
    kind: "link",
    title: "The Federalist No. 10",
    source_url: "https://en.wikipedia.org/wiki/Federalist_No._10",
    content_html: federalist,
    pdf_url: null,
    status: "running",
    created_by: null,
    summary: null,
    ai_status: null,
  },
  {
    id: "demo-attention",
    kind: "file",
    title: "Attention — reading notes.md",
    source_url: null,
    content_html: attention,
    pdf_url: null,
    status: "running",
    created_by: null,
    summary: null,
    ai_status: null,
  },
];

export const DEMO_CREATED_AT = at;
