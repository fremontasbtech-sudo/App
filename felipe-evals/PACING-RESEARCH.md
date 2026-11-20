# Ask Felipe: how fast it should answer, and how the answer should appear

Written 2026-11-20. Three research passes ran in parallel (response delay, answer reveal and motion, answer quality and chat UX). This file keeps what they found, the sources, where the evidence is weak, and the numbers Felipe now uses. The code is the "pacing" block in `FirebirdHub/app.js` (constant `PACE`).

## 1. The problem

Felipe answered many questions in well under half a second. About half of all questions are answered on the phone from the app's data, and others come from the shared answer cache. Replies that fast look canned. Students read them as a lookup table, not as an assistant that understood the question.

## 2. What the research says about delay

**A short delay helps, but less for experienced users.**
- Gnewuch, Morana, Adam and Maedche ran a lab experiment with 202 university students. The paper is "Opposing Effects of Response Time in Human-Chatbot Interaction," *Business & Information Systems Engineering* 64(6), 2022: https://doi.org/10.1007/s12599-022-00755-x. The first version appeared at ECIS 2018: https://aisel.aisnet.org/ecis2018_rp/113/
  - "Instant" replies took 200 to 400 ms. Delayed replies averaged 2.3 s.
  - A delay raised the feeling of talking to someone for people new to chatbots.
  - It lowered that feeling for people who had used chatbots before.
  - A delay that scaled with how complex the reply was (0 ms for "Hello", up to about 4 s) and a flat 2.3 s delay were rated the same. Having a delay mattered more than how it was calculated.
- Most high school students have used ChatGPT or similar tools, so they count as experienced. That argues for a delay that is short, well under 2.3 s for a typical answer.

**Human-like cues work in the field but have side effects.**
- Schanke, Burtch and Ray, "Estimating the impact of 'humanizing' customer service chatbots," *Information Systems Research* 32(3), 2021: https://doi.org/10.1287/isre.2021.1015
  - Their chatbot "typed" at 70 words per minute. On its own, that delay did not change conversion.
  - Combined with a name and humor, the human-like cues raised conversion. They also made users more price-sensitive.
  - In a separate crowd-worker study, people disliked the delay. The authors note that paid workers lose money while they wait.
- Typing at 70 words per minute, or the 50 ms per character used by Holtgraves and Han (2007), would make a paragraph take 10 s or more. That is far too slow for a school Q&A tool.

**Showing the work makes a wait feel worth it.**
- Buell and Norton, "The Labor Illusion," *Management Science* 57(9), 2011: https://doi.org/10.1287/mnsc.1110.1376
  - A flight search that showed which airlines it was checking was valued more than a blank wait, and as much as instant results.
  - With waits of 30 to 60 s, 62 to 63% chose the slower site that showed its work. Only 23 to 42% chose it when the wait was blank.
  - One limit: when the result was bad, visible effort made people rate it worse.
- Felipe therefore shows a short, true line about what it is checking ("Checking the bell schedule"), not a fake "typing…". When Felipe can't help, the line stays empty, so effort is never shown next to a "can't help" reply.

**Long waits hurt.**
- Nielsen's response-time limits are 0.1 s (feels instant), 1 s (the user's train of thought holds) and 10 s (attention drifts): https://www.nngroup.com/articles/response-times-3-important-limits/
- A study of LLM agents found the experience got clearly worse above 4 s, and 57% of people preferred 1.5 s (Maslych et al., CUI 2025): https://arxiv.org/abs/2507.22352
- A CHI 2026 study compared first words at 2, 9 and 20 s. People rated 2 s answers as *less* thoughtful, but long waits turned into frustration (Tan, Messerschmidt, Yin and Nov): https://arxiv.org/abs/2604.06183
- Together these suggest a pause of roughly 1 to 2.5 s, never added on top of time already spent on the network.

## 3. What the research says about how the answer appears

- **Reading speed.** Adults read non-fiction at about 238 words per minute, roughly 20 characters a second (Brysbaert 2019, https://doi.org/10.1016/j.jml.2019.104047). High schoolers read at 214 to 250 words per minute, depending on grade.
- **Reveal speed in other assistants.**
  - Production assistants reveal text 10 to 40 times faster than people read. Model output runs about 55 to 235 tokens a second.
  - The Vercel AI SDK's `smoothStream` re-paces text word by word every 10 ms.
  - No company publishes its reveal rate, and no controlled study compares reveal rates. The case for a fast word-by-word reveal rests on reading-rate math and common practice.
- **Don't fake a person typing.** Williams-Ceci et al. (2024) found that a "typewriter" effect made people believe a false claim more, by making the bot seem more human. Felipe's reveal is quick and plainly mechanical: whole words, fast.
- **Motion.**
  - Material Design puts mobile entrance motion at 200 to 300 ms with a decelerating curve (https://m2.material.io/design/motion/speed.html, https://m3.material.io/styles/motion/easing-and-duration).
  - Only opacity and transform should be animated, so the page doesn't reflow.
  - WCAG 2.3.3 asks that non-essential motion be dropped when the user turns on reduced motion (https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html).
- **Typing dots.** The common pattern is 3 dots on a cycle of about 1.2 to 1.4 s, each dot starting about 150 to 200 ms after the last. This is convention, not tested evidence.
- **Screen readers.**
  - A chat log should be `role="log"` (MDN, https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions).
  - A streamed answer read through a live region gets announced chunk by chunk, which is unusable. The fix is to announce the finished answer once, from a separate live region that stays on the page (https://github.com/openclaw/openclaw/issues/65538, https://tetralogical.com/blog/2024/05/01/why-are-my-live-regions-not-working/).
- **Scrolling.** NN/g says not to scroll the start of a reply out of view (https://www.nngroup.com/articles/ai-chatbots-design-guidelines/).

## 4. What the research says about the answers themselves

- **Short, answer first.** NN/g's "truncated pyramid" says to give only what was asked plus any needed caveat, and to offer follow-ups for more (https://www.nngroup.com/articles/less-chat-more-answer/). In a small chat window, one paragraph already looks like a wall of text.
  - Felipe's prompt already asks for the direct answer first, in 1 to 3 sentences, with no headers and no emoji (`api/_felipe/prompt.js`). No change was needed.
  - This study watched only 9 adults and gives no word count.
- **Tone and persona.**
  - Replies that respond to what the user actually said make a bot feel human without an avatar. Claiming to be human raises expectations the bot then fails (Go and Sundar 2019, https://doi.org/10.1016/j.chb.2019.01.020).
  - Saying plainly that it's an AI costs little, and helps when the bot gets something wrong (Mozafari, Weiger and Hammerschmidt 2022, https://doi.org/10.1108/JOSM-10-2020-0380).
  - Telling users how well the system works is guideline 2 of Microsoft's human-AI guidelines (Amershi et al., CHI 2019, https://dl.acm.org/doi/fullHtml/10.1145/3290605.3300233).
  - No study tested persona effects on 14 to 18 year olds.
- **Follow-up suggestions.**
  - Suggestions should be tappable, fit the conversation, and not be pushed again once skipped (NN/g, https://www.nngroup.com/articles/prompt-suggestions/). Material keeps chip labels short.
  - Showing 2 or 3 is common practice. No study measured the best number.
- **Failures.**
  - In Ashktorab et al. (CHI 2019, N=203, https://doi.org/10.1145/3290605.3300484), people most preferred a bot that offered options when it failed.
  - Error messages should say what went wrong in plain words and give a next step (NN/g heuristic 9).
- **Weak spots.** Almost all of this comes from adults, students in Europe, crowd workers or one retailer. Nobody has tested it on high schoolers or a school bot. The experienced-user finding comes from one lab study.

## 5. What Felipe does now (numbers)

| Setting | Value | Why |
|---|---|---|
| Dots appear | 300 ms after the question | Felipe "reads" first. Shorter waits would make the dots flicker. |
| Pause before the answer | 700 ms + 8 ms per question character + 3 ms per answer character, ±10% | Comes out to about 1.0 to 1.9 s for normal questions. Clearly above the 200 to 400 ms "instant" band, and under the 2.3 s studied. Longer questions and answers take a little longer. |
| Lowest and highest | 700 ms and 2,500 ms | The cap stays well under the 4 s point where experience drops. |
| One-line replies (under 40 characters, like "You're welcome!") | about 500 to 600 ms | Short social replies shouldn't wait as long as an answer. |
| From a student's 4th answer on | 70% of the pause | Experienced users find delays less helpful (Gnewuch 2022). |
| Time already spent on the network | counts toward the pause | A slow answer is never held back. The answer shows as soon as it's ready if that is later than the pause. |
| Working line | "Checking the bell schedule", "Checking the sports schedule", "Checking the events calendar", "Checking spirit points", "Reading the announcements", "Looking through the clubs", "Looking at your assignments" | Labor illusion. The line is always true for that question. It stays empty for general questions and for "can't help" replies. |
| Still waiting | after 4.5 s the line becomes "Still checking…" | Based on the 4 s threshold. |
| Reveal | whole words at 180 characters a second or faster, so a full answer appears in under 1 s | About 9 times reading speed, in the range of production assistants. Tapping the answer shows all of it at once. |
| Entrance | fade in and rise 8 px over 220 ms (user bubbles 160 ms), `cubic-bezier(.05,.7,.1,1)` | Material emphasized-decelerate curve, opacity and transform only. |
| Dots | 7 px, 1.2 s cycle, 160 ms stagger, opacity and 3 px lift | Common convention. |
| Reduced motion | same pause, still dots, no fade, the answer appears whole | WCAG 2.3.3. The pause is not motion, so it stays. |
| Crisis replies | shown at once, no pause | Safety comes first. |
| Screen readers | a hidden status region says "Felipe is thinking", then reads the whole answer once. The log is `role="log"` with `aria-live="off"`. | Avoids word-by-word announcements. |
| Scrolling | follows a growing answer only if the student was already at the bottom, and never scrolls its first line out of view | NN/g guidance. |
| Follow-ups | up to 2 short chips that fit the answer just given. A chip the student skipped isn't offered again. | NN/g, Material. |
| Can't reach Felipe | plain message plus a "Try again" button | Ashktorab 2019, NN/g heuristic 9. |
| Disclosure | "Felipe is an AI and can make mistakes. Answers aren't monitored live." under the input | Amershi guideline 2, Mozafari 2022. |

Measured locally on 2026-11-20 with the mock server, at phone and desktop sizes:
- Dots appeared at 300 ms.
- Answers started between 0.9 and 1.8 s.
- Each reveal finished 0.5 to 1.0 s later.
- With reduced motion, the answer appeared whole at about 1.0 s.

## 6. Not done, and why

- **Copy button on answers.** Answers are 1 to 3 sentences, and Abir asked for no extra UI.
- **Disabling Send while Felipe answers.** One review says to do this. The app already queues questions in order, so nothing typed is lost.
- **Keyboard-inset handling for iOS.** The panel already sits above the bottom bar, and nothing was reported.
- **A wait that scales with reading complexity, as in Gnewuch's formula.** It was rated the same as a flat delay, so a simple length-based formula is enough.
