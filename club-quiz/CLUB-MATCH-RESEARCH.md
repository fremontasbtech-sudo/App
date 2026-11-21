# Find your club: research behind the matching and the match labels

Written 2026-11-20 for the Firebird Hub quiz rebuild. Two parts, each from its own research pass: Part A on how to score matches, Part B on how to show match strength. Each source is marked as checked online or cited from memory; weak or inferred points are marked. How these findings were applied is in README.md.

---

# Part A.
## Matching students to clubs: what the evidence says, and a scoring model

Written 2026-11-20 for the Firebird Hub "Find your club" quiz (4 to 6 questions, about 76 clubs, about 23 interest keys, 6 activity styles, commitment level, openness).

Labels used below: **[Supported]** means a published study or standard method says this directly. **[Inference]** means I am extending evidence from another setting (jobs, documents, surveys) to high school clubs.

---

### 1. Interest-to-option matching (vocational psychology)

**Congruence indices.** Holland's RIASEC theory matches a person's interest code to an environment's code. Many indices exist: hexagon-distance indices on the first letter, the Brown and Gore C-index (weights the first three letters 3, 2, 1 and scores hexagon distance), the Iachan M-index (letter-order agreement), and profile-based measures (correlation or Euclidean distance between full score profiles).
- Brown, S. D., & Gore, P. A. (1994). An evaluation of interest congruence indices. *Journal of Vocational Behavior, 45*(3), 310-327. https://psycnet.apa.org/record/1995-11831-001 . Compared 10 indices; found the letter-code indices have odd, lumpy distributions with many ties, and proposed the C-index as better behaved. **[Supported]**
- Iachan, R. (1984). A measure of agreement for use with the Holland classification system. *Measurement and Evaluation in Guidance, 17*, 133-141. **[Supported, older]**

Why this matters for us: letter-code indices compress a profile to 3 letters, which throws away information and creates ties. That is the same problem as "4 clubs all score 3 points." Continuous profile measures avoid it. **[Inference from Brown and Gore]**

**How O*NET does it.** The O*NET Interest Profiler (Rounds, Hoff, and Lewis, eds., *O*NET Interest Profiler Manual*, March 2021, https://www.onetcenter.org/dl_files/IP_Manual.pdf) links a person to occupations with the **correlation between the person's 6-score profile and the occupation's profile**. The manual says this indexes the shape of the profile, not its level. Thresholds: r of .729 or more is "Best Fit," .608 to .728 "Great Fit," 0 to .607 "Good Fit." Results are then shown **within a Job Zone the user picks** (the amount of preparation they want), which acts as a filter. **[Supported]** Two lessons: (a) a shape-based similarity (correlation or cosine) is the production standard; (b) a practical-constraint variable (Job Zone, our commitment level) is handled separately from interests, not mixed into the interest score.

**Does congruence predict satisfaction? Modestly.**
- Tinsley, H. E. A. (2000). The congruence myth. *Journal of Vocational Behavior, 56*(2), 147-179. https://doi.org/10.1006/jvbe.1999.1727 . Argued that hexagonal congruence is not reliably related to satisfaction and that the hexagon geometry adds little. **[Supported as his conclusion; it was contested in the same journal issue.]**
- Assouline, M., & Meir, E. I. (1987), *JVB 31*, 319-332, meta-analysis: mean congruence-satisfaction r of about .21. Tsabari, Tziner, & Meir (2005), *Journal of Career Assessment 13*(2), 216-232, update: about .17. **[Supported; numbers from memory of the abstracts, check before quoting.]**
- Hoff, K. A., Song, Q. C., Wee, C. J. M., Phan, W. M. J., & Rounds, J. (2020). Interest fit and job satisfaction: A systematic review and meta-analysis. *JVB, 123*, 103503. https://doi.org/10.1016/j.jvb.2020.103503 . 105 studies, k = 194, N = 39,602: rho = .19 (95% CI .16 to .21) with overall job satisfaction, stronger for satisfaction with one's career choice in general. **[Supported, abstract read]**
- Nye, C. D., Su, R., Rounds, J., & Drasgow, F. (2012). Vocational interests and performance: A quantitative summary of over 60 years of research. *Perspectives on Psychological Science, 7*(4), 384-403; and Nye et al. (2017). Interest congruence and performance: Revisiting recent meta-analytic findings. *JVB, 98*, 138-151. https://doi.org/10.1016/j.jvb.2016.11.002 . Congruence predicts performance and persistence better than raw interest scores do, and it predicts these outcomes better than it predicts satisfaction. **[Supported]**

Takeaway: interest fit is real but modest (about r = .2 for satisfaction). A quiz should present its result as "clubs worth trying," never as a precise percentage. Other factors (people, leaders, workload) matter as much or more. **[Supported for jobs; Inference for clubs]**

---

### 2. Content-based recommender scoring with sparse tags

Standard reference: Pazzani, M. J., & Billsus, D. (2007). Content-based recommendation systems. In *The Adaptive Web*, LNCS 4321, 325-341. Users and items are vectors over the same features, scored by similarity. **[Supported]**

**Cosine vs. overlap vs. Jaccard.**
- *Raw weighted overlap* (dot product) rewards clubs with many tags. A club tagged with 8 interests beats a focused club on almost any answer. This is the main cause of "the same 3 clubs always win." **[Supported: this is the length bias that motivated length normalization in IR; Salton, G., & Buckley, C. (1988). Term-weighting approaches in automatic text retrieval. *Information Processing & Management, 24*(5), 513-523.]**
- *Jaccard* treats tags as present or absent, so it discards the weights you are adding. It also punishes a broad club heavily. Good for club-to-club similarity on binary tags, weak for weighted user-to-club scoring. **[Inference]**
- *Cosine* normalizes both vectors, so a club's score reflects how much of its identity matches, not how many tags it has. It equals O*NET's profile correlation without mean-centering. **[Supported]**
- Full cosine can over-correct and favor single-tag clubs. IR fixed this with *pivoted length normalization* (Singhal, Buckley, & Mitra, 1996, SIGIR, https://doi.org/10.1145/243199.243206) and BM25's length parameter b (Robertson & Zaragoza, 2009, *Foundations and Trends in IR 3*(4)). The practical equivalent: divide by club norm raised to a power between 0.5 and 1 (about 0.75). **[Supported in IR; Inference for clubs]**

**IDF so rare tags matter more.** IDF (Spärck Jones, 1972, *Journal of Documentation 28*(1)) down-weights terms that appear on many items. If "service" is on 25 clubs and "culture_heritage" on 4, a student who picks culture should see the 4, not get buried under general service clubs. Use smoothed IDF: idf(k) = ln((N + 1) / (df(k) + 1)) + 1. With N = 76 that ranges from about 1.0 to 4.6, which can be too strong when tags are sparse; take the square root to soften it. **[Supported method; softening is Inference]**

**Multi-select answers.** Give each question a fixed budget of 1.0 and split it evenly across selections (1/n). Otherwise a student who ticks 5 boxes on one question lets that question dominate the profile. This is the same idea as L1-normalizing a term-frequency vector. **[Inference from standard normalization practice]** Cap selections at 2 or 3 (see section 3).

**Hard filters vs. soft penalties.** O*NET filters by Job Zone because the user picked it explicitly. Recommender practice: use hard filters only for true constraints the user stated; use soft multiplicative penalties for preferences, because hard filters on noisy single answers wipe out good options and can make clubs unreachable. **[Supported for O*NET; general practice is Inference]** Commitment is a preference with real consequences, so a graded penalty fits.

**Ties.** Ties come from coarse scores (integer points, few questions). Fix the cause with continuous weights, IDF and cosine. Break the rest with secondary keys (interest score, then number of matched tags). Avoid alphabetical order, which always favors the same clubs. **[Inference]**

**Diversity in top-k.**
- Carbonell, J., & Goldstein, J. (1998). The use of MMR, diversity-based reranking for reordering documents and producing summaries. *SIGIR '98*, 335-336. https://doi.org/10.1145/290941.291025 . Pick the next item by lambda times relevance minus (1 - lambda) times its maximum similarity to items already picked. **[Supported]**
- Ziegler, C.-N., McNee, S. M., Konstan, J. A., & Lausen, G. (2005). Improving recommendation lists through topic diversification. *WWW '05*. Users rated diversified lists as better overall even though accuracy dropped slightly. **[Supported]**
For 3 to 5 results, lambda of about 0.7 keeps the top match and stops three near-identical results (for example three coding clubs). **[Inference]**

---

### 3. Short quiz design, and what predicts club satisfaction

**Number of questions and options.**
- Fewer items mean lower reliability (Spearman-Brown). Single-item measures of a broad trait are noisy. **[Supported, classical test theory]**
- Cronbach and Gleser's bandwidth-fidelity trade-off: a broad question ("social or focused?") covers a lot but measures each aspect poorly. Broad single-dimension questions add noise because students interpret them differently and because most clubs mix both poles. **[Supported concept; application to this quiz is Inference]**
- Choice overload: Iyengar and Lepper (2000) found that large option sets reduce choosing, but Scheibehenne, Greifeneder, and Todd (2010, *Journal of Consumer Research 37*(3), 409-425) meta-analysis found a mean effect near zero. Option count is not critical, but 4 to 8 options per question that are easy to scan is a safe range. **[Supported, mixed]**
- Rodriguez (2005, *Educational Measurement: Issues and Practice 24*(2), 3-13) found 3 options are often enough for test items. That concerns knowledge tests, so it is weak evidence here. **[Extrapolated]**

**Forced choice vs. multi-select.** Smyth, Dillman, Christian, and Stern (2006). Comparing check-all and forced-choice question formats in web surveys. *Public Opinion Quarterly, 70*(1), 66-77. https://doi.org/10.1093/poq/nfj007 . In 16 experiments, check-all lists led to fast skimming and primacy effects (top options picked more). Forced-choice (yes/no per item) made people process every option. **[Supported]** For a quiz: shuffle option order per student, keep lists short, and cap selections at 2 or 3 ("pick up to 2"). A blank option in a check-all list does not mean "not interested," so never give negative weight to unselected options. **[Inference from Smyth et al.]**

**What predicts satisfaction and staying in an activity.**
- Self-determination theory: Ryan, R. M., & Deci, E. L. (2000). *American Psychologist, 55*(1), 68-78. Autonomy, competence and relatedness drive sustained motivation. **[Supported]** For the quiz this suggests asking about interest (autonomy: "what would you choose to do"), comfort level (competence: beginner-friendly vs. experienced), and people (relatedness: friends, meeting new people). **[Inference]**
- Larson, R. W. (2000). Toward a psychology of positive youth development. *American Psychologist, 55*(1), 170-183. Structured voluntary activities pair intrinsic motivation with concentrated effort over time. **[Supported]**
- Eccles, J. S., & Barber, B. L. (1999). *Journal of Adolescent Research, 14*(1), 10-43; Fredricks, J. A., & Eccles, J. S. (2006). *Developmental Psychology, 42*(4), 698-713; Feldman, A. F., & Matjasko, J. L. (2005). *Review of Educational Research, 75*(2), 159-210. Participation is linked to better outcomes, and the activity type and the peer group matter. **[Supported, correlational]**
- Persson, A., Kerr, M., & Stattin, H. (2007). Staying in or moving away from structured activities: Explanations involving parents and peers. *Developmental Psychology, 43*(1), 197-207. https://pubmed.ncbi.nlm.nih.gov/17201519/ . Leaving activities is tied to the pull of peers outside the activity more than to parents. **[Supported; I read only the abstract snippet]**
- Lent, Brown, and Hackett's social cognitive career theory (1994, *JVB 45*, 79-122): self-efficacy shapes interest and persistence. A "beginners welcome" signal helps students who have the interest but not the confidence. **[Supported theory; application is Inference]**

What I found no direct evidence for: a validated instrument that matches high school students to specific clubs, or any study of "club fit" predicting retention. Everything in sections 1 and 2 applied to clubs is extrapolated.

---

### 4. Recommended scoring formula

**Club data.**
- Interest tags: weight 3 (core), 2 (strong), 1 (side). Keep 1 to 4 tags per club. Every club must have at least one weight-3 tag that a quiz answer can reach.
- Style tags: weight 2 (main), 1 (also).
- Commitment: light = 0, regular = 1, heavy = 2. Openness: open, community, selective.

**Step 1. Build the student vectors.** Each interest question has budget 1.0, split evenly over the selected options (cap 2 or 3). Each option maps to one or two interest keys (split its share if two). Sum into u_I (23 keys). Do the same for the style question into u_S (6 keys). Never subtract for unselected options.

**Step 2. Apply softened IDF to club interest weights.** idf(k) = sqrt(ln((76 + 1) / (df(k) + 1)) + 1), where df(k) is the number of clubs with tag k. c'_I[k] = c_I[k] x idf(k).

**Step 3. Interest similarity with partial length normalization.**
S_I = (u_I . c'_I) / (|u_I| x |c'_I|^0.75 x |c'_max|^0.25), where |c'_max| is the largest club norm, so scores stay in 0 to 1 and broad clubs are not over-punished. If you want simpler code, plain cosine is acceptable.

**Step 4. Style similarity.** S_S = cosine(u_S, c_S). If the student skipped the style question, S_S = 0.5 for all clubs.

**Step 5. Combine.** Base = 0.70 x S_I + 0.30 x S_S. Interests get the larger share because the vocational evidence is about interest content; style is the tie-breaking dimension. **[Inference; tune with test answers]**

**Step 6. Commitment as a soft multiplier.** d = |student level - club level|. Multiplier 1.00 if d = 0, 0.85 if d = 1, 0.60 if d = 2. Apply as a hard filter only if the student explicitly chose "only light commitment," and then still show heavy clubs below a divider rather than hide them.

**Step 7. Openness.** Selective clubs get x 0.90 only for students who said they want to drop in; otherwise no change. Always show a "tryouts or application" note on selective clubs.

**Step 8. Final score and ties.** Score = Base x commitment x openness. Ties broken by S_I, then by number of the student's chosen keys the club covers, then by a hash of the student's answers (stable for a student, varied across students). Never alphabetical.

**Step 9. Diversify the top results with MMR.** Take the top 15 by score. Pick results one at a time to maximize 0.7 x Score - 0.3 x max cosine(club, already picked clubs), using club interest vectors. Show 3 to 5.

**Step 10. Honest match display.** Do not show the raw number as "97% match." The best available evidence puts interest fit at about r = .2 with satisfaction. Show bands from absolute score: "Strong match" (score of 0.60 or more), "Good match" (0.40 to 0.59), "Worth a look" (below 0.40), with thresholds set by simulation. Show the reason in words ("You picked coding and building things") from the matched keys. If no club reaches 0.40, say so and show the closest options.

**Step 11. Test before shipping.** Enumerate or sample every answer combination (with single-select and a selection cap, this is a few thousand to tens of thousands of runs). Check that (a) every club appears in the top 5 for at least one realistic answer set, (b) no club appears in the top 5 for more than about 15% of answer sets, (c) the gap between rank 1 and rank 5 is rarely zero. Fix failures by retagging clubs, not by adding special cases.

---

### 5. Weak or extrapolated evidence

1. All congruence evidence is about jobs and careers with adults. No study tests interest-tag matching for high school clubs. **[Extrapolated]**
2. The effect size is small (rho of about .19 for job satisfaction). Even a perfect matching formula will often be wrong for individual students.
3. Tinsley (2000) vs. later meta-analyses: the debate is about whether hexagon structure adds value; it does not decide cosine vs. correlation. Choosing cosine rests on IR practice and O*NET's use of correlation, not a head-to-head satisfaction study.
4. IDF softening (square root), the 0.75 length exponent, the 0.70/0.30 split, the commitment multipliers, MMR lambda = 0.7 and the band thresholds are my judgment calls. They should be tuned by simulation and, later, by real feedback (did the student join, did they stay).
5. The SDT and extracurricular studies are correlational and describe why students stay, not how to match them. Using them to choose quiz questions is reasonable but untested.
6. Smyth et al. (2006) studied adult and college web surveys, not short teen quizzes.
7. Some citation details (Assouline and Meir, Tsabari et al., page numbers for older papers) are from memory of the abstracts; check them before quoting publicly. The Hoff et al. (2020), O*NET manual, Smyth et al. (2006), Tinsley (2000), Brown and Gore (1994), Nye et al. (2017), Persson et al. (2007) and Carbonell and Goldstein (1998) details were checked against the sources linked above.

---

# Part B.
## How to show match strength in the "Find your club" quiz: research notes

Written 2026-11-20. Problem: results say things like "27% match" for the top club, often with three clubs tied, and students say the percents feel inaccurate.

Sources marked **[checked]** were opened or confirmed by search for this report. Sources marked **[from memory]** are well-known papers cited from prior knowledge; confirm details before quoting them publicly.

---

### 1. How people read match percentages

**Netflix changed its approach twice.** In March 2017 Netflix replaced 5-star ratings with thumbs up and down and added a "% Match" score. VP of Product Todd Yellin said that in testing the thumbs got over 200% more ratings than stars (The Verge, 2017-03-16, https://www.theverge.com/2017/3/16/14952434/netflix-five-star-ratings-going-away-thumbs-up-down) **[checked]**. In January 2024 the New York Times reported, and a Netflix rep confirmed to IndieWire, that Netflix would drop the Match percentages and show short descriptive tags instead (Maglio and Welk, IndieWire, 2024-01-16, https://www.indiewire.com/news/business/match-percentages-netflix-going-away-1234944402/; Griffin, The Independent, 2024-01-24, https://www.the-independent.com/tech/netflix-match-score-algorithm-series-movies-b2483824.html) **[checked]**. The reported reason was that viewers found the percentage "confounding". Netflix's chief product officer, Eunice Kim, said tags help people decide fast, because the chance someone watches anything drops sharply after about 53 seconds of browsing. User complaints also show inflation: a long-running r/netflix thread says nearly everything shows as a "98% match", so the number stopped telling titles apart (https://www.reddit.com/r/netflix/comments/8u0bw4/) **[checked, anecdotal]**. Lesson: a large platform found that a precise-looking percent confused people more than it helped, and replaced it with words that explain the pick.

**OkCupid showed that the displayed number changes behavior.** In "We Experiment On Human Beings!" (Christian Rudder, OkTrends blog, 2014-07-28, archived at https://gwern.net/doc/psychology/okcupid/weexperimentonhumanbeings.html) **[checked]**, pairs whose real match was 30% were shown 90%. They were more likely to keep a conversation going (4 or more messages) than when they saw their true score. Real 90% matches who were shown 30% did worse than when shown the truth (summary in The Guardian, 2014-07-29). Rudder's conclusion was that the number works partly as suggestion. For the club quiz this cuts both ways: a low displayed number will make students less interested in a club that actually fits them, and an inflated number creates false confidence.

**Other products** **[from memory]**: Hinge's "Most Compatible" (2018) shows one daily pick with a label and no percent. 16Personalities shows percents per trait ("72% Introverted"), never a single overall fit. The O*NET Interest Profiler (US Dept. of Labor) shows raw scores on six interest areas and suggests careers by your top area, with no "% match". BuzzFeed quizzes give one result and no number. Spotify Blend shows a "taste match" percent between two people. Most career and personality tools avoid one overall fit percent.

**What number reads as "good".** No study measures where match percents start to feel good. What we do have:
- **Grading anchors.** US students learn that 90% is an A, 70% a C and below 60% failing. Treating a match percent like a grade is likely, but that is an inference, not a measured result **[weak evidence]**. Under that reading, 27% looks like a failing grade even when it is the best result.
- **Left-digit effect.** People judge numbers mostly by the first digit: $2.99 feels much cheaper than $3.00 (Thomas and Morwitz, 2005, *Journal of Consumer Research* 32(1)), and used-car prices drop sharply at each 10,000-mile odometer mark (Lacetera, Pope and Sydnor, 2012, *American Economic Review* 102(5)) **[from memory]**. So 79% reads as "a 70-something" and 80% as "an 80-something".
- **Inflation norms.** When most ratings sit near the top (app stores, ride-share ratings, Netflix's 98%s), people learn to read anything below the usual range as bad. Students who have seen Netflix-style numbers will expect the top match to be high.

**Precision bias.** Precise numbers signal confidence. People judge a speaker who gives a precise figure as more confident and more knowledgeable (Jerez-Fernandez, Angulo and Oppenheimer, 2014, "Show me the numbers: Precision as a cue to others' confidence", *Psychological Science* 25(2), 633-635, https://doi.org/10.1177/0956797613504301) **[checked]**. Precise anchors pull estimates harder than round ones (Janiszewski and Uy, 2008, *Psychological Science* 19(2)), and precise claims are believed more until the precision looks implausible (Xie and Kronrod, 2012, *Journal of Advertising* 41(4)) **[from memory]**. A 20-question quiz can't support "27%" against "26%". When the decimals turn out to be meaningless (three clubs tied, or a result that obviously misses), the false precision makes the quiz look less trustworthy. That matches the student feedback.

---

### 2. Calibration and honesty

**Verbal labels vs numbers.** Words are read with very wide ranges. Wallsten, Budescu and colleagues showed that phrases like "likely" mean quite different probabilities to different people, even though each person is fairly consistent (Budescu and Wallsten, 1985, *Organizational Behavior and Human Decision Processes* 36; Wallsten et al., 1986, *Journal of Experimental Psychology: General* 115(4)) **[from memory]**. When the IPCC climate reports defined their verbal terms, readers still read them closer to 50% than the definitions said (Budescu, Broomell and Por, 2009, *Psychological Science* 20(3)) **[from memory]**. Mauboussin and Mauboussin surveyed about 1,700 people (HBR, 2018-07-03, https://hbr.org/2018/07/if-you-say-something-is-likely-how-likely-do-people-think-it-is) **[checked]**. "Likely" had a median of 71% with a middle-50% range of 62 to 76%, while "real possibility" ranged from 14.5% to 91% between the 5th and 95th percentiles (Morgan Stanley, "Probabilities and Payoffs", https://www.morganstanley.com/im/publication/insights/articles/article_probabilitiesandpayoffs.pdf) **[checked]**. Their advice is to use numbers when precision matters.

For this quiz, that argument works the other way. The quiz can't give real precision, so a label's fuzziness is honest: "Great fit" promises less than "87%". The aim isn't a decision that depends on exact odds, only ranking a few clubs and getting students to try one. Labels that are clearly ordered (Great, Good, Worth a look) avoid the wide ranges of probability words, because they don't claim a probability at all.

**Showing uncertainty.** Across 5 experiments, van der Bles, van der Linden, Freeman and Spiegelhalter (2020, *PNAS* 117(14)) found that admitting uncertainty with a numeric range barely lowered trust in the numbers or the source. Vague verbal hedges lowered it more **[from memory]**. Being open about how rough a result is does little harm, as long as it is concrete.

**Teens and numeracy.** Many adults and teens misread percents and ratios (PISA math results; Peters et al., 2006, *Psychological Science* 17(5), on numeracy and judgment) **[from memory]**. Bars and labels need less numeracy than percents. I found no study comparing number and label comprehension in teens specifically **[gap]**.

**Should the top result ever show a low number?** No study answers this directly. Taken together, the evidence above says a low absolute number on the best result reads as failure (grading anchor), lowers interest (OkCupid), and looks false when the experience says otherwise. Stretching the top up to 95% for everyone is also dishonest and turns into Netflix's "98% on everything". The honest middle is to tell students two things separately:
1. **Relative:** "This is your strongest match out of the 60 clubs" (always true for #1).
2. **Absolute strength**, in rough tiers, based on how the score compares with what is achievable, not with a theoretical 100%.

---

### 3. "Why this matched" explanations

- **Herlocker, Konstan and Riedl (2000)**, "Explaining collaborative filtering recommendations", CSCW 2000 **[from memory]**. They tested 21 explanation interfaces on MovieLens users. Simple, concrete explanations (a histogram of how similar users rated the film, or "this system has been right for you before") raised willingness to try a pick most. Complex or statistical displays did worse than no explanation.
- **Tintarev and Masthoff (2007)**, "A survey of explanations in recommender systems", ICDE Workshops; expanded in the *Recommender Systems Handbook* (2011, 2015) **[from memory]**. They name 7 goals: transparency, scrutability, trust, effectiveness, persuasiveness, efficiency and satisfaction. Explanations meant to persuade can hurt effectiveness. The best explanations help people judge whether a pick suits them.
- **Gedikli, Jannach and Ge (2014)**, "How should I explain?", *International Journal of Human-Computer Studies* 72(4), https://doi.org/10.1016/j.ijhcs.2013.12.007 **[checked]**. They compared 10 explanation types in a user study. Feature- and content-based explanations (tag clouds of what matched) scored well on transparency and satisfaction and helped users estimate how much they would like an item. Some popular explanation styles made users over-estimate.
- **Kunkel, Donkers, Michael, Barbu and Ziegler (2019)**, "Let Me Explain", CHI 2019, https://doi.org/10.1145/3290605.3300717 **[checked]**. People trusted recommendations from humans more than from systems, partly because human explanations were richer. Explanation quality significantly raised perceived recommendation quality and trust. The authors advise systems to give richer explanations.
- **Vig, Sen and Riedl (2009)**, "Tagsplanations", IUI 2009 **[from memory]**. Explanations that named the specific traits a user liked ("because you like dark comedy") helped users understand picks.
- **NN/g, "Can Users Control and Understand a UI Driven by Machine Learning?"** (Budiu, 2018, https://www.nngroup.com/articles/machine-learning-ux/) **[checked]**. In their study, users were confused when the order of recommendations had no meaning they could see, and wanted to know why items appeared.

**What makes a good explanation:** specific to this student's answers ("You picked building things and working on a team"), short (one line), honest (only reasons that actually drove the score), and checkable (the student recognizes their own answers). Avoid generic lines that could fit anyone (see section 5).

---

### 4. How many results to show

- **Iyengar and Lepper (2000)**, *Journal of Personality and Social Psychology* 79(6) **[from memory]**. In the jam study, 30% of shoppers who saw 6 jams bought one, against 3% of those who saw 24.
- **Scheibehenne, Greifeneder and Todd (2010)**, *Journal of Consumer Research* 37(3), 409-425 **[checked]**. A meta-analysis of 63 conditions from 50 experiments (N = 5,036) found an average choice-overload effect of about zero, with large differences between studies. Overload is not automatic.
- **Chernev, Böckenholt and Goodman (2015)**, "Choice overload: A conceptual review and meta-analysis", *Journal of Consumer Psychology* 25(2) **[from memory]**. Overload is real under 4 conditions: hard-to-compare options, a hard decision task, unclear preferences, and a goal of picking one best option. Students choosing clubs often have unclear preferences, so overload risk is real. A short, ranked list helps.

Neither meta-analysis gives an ideal number. Most of the small sets in these studies had about 6 options, and product practice commonly shows 3 picks. **Top 3 plus a smaller "also worth a look" tier of 2 or 3** fits both: a short list to decide from, without hiding close alternatives. The "3 versus 5" choice rests on practice, not direct evidence **[weak evidence]**.

**Near-ties.** I found no study of how showing tied recommender scores affects trust. Indirectly: identical numbers on different clubs show that the score can't separate them, which undercuts any decimal-level claim (the precision problem in section 1). Showing ties honestly as a group ("These 3 fit you equally well") fits the honesty principle in Tintarev and Masthoff. **[weak or indirect evidence]**

---

### 5. Barnum effect and effort

- **Forer (1949)**, *Journal of Abnormal and Social Psychology* 44(1) **[checked via secondary sources, e.g. https://en.wikipedia.org/wiki/Barnum_effect]**. 39 students rated an identical generic personality sketch as fitting them at 4.26 out of 5 on average. Later work found acceptance rises when feedback seems personal, comes from a trusted source, and is mostly positive (Snyder, Shenkel and Lowery, 1977, *Journal of Consulting and Clinical Psychology* 45(1); Dickson and Kelly, 1985, *Psychological Reports* 57) **[from memory]**. For the quiz: students will accept almost any upbeat result. Believability alone isn't a sign the quiz works, and generic "why" lines can fool both students and the people building the quiz. Specific, checkable reasons are the guard.
- **Effort effects.** People value what they put work into (IKEA effect: Norton, Mochon and Ariely, 2012, *Journal of Consumer Psychology* 22(3)). People also value a service more when they can see it working on their behalf (labor illusion: Buell and Norton, 2011, *Management Science* 57(9)) **[from memory]**. After answering the questions, students expect a payoff that reflects their answers. A result that echoes their answers ("Because you picked...") pays off that effort. A flat "27%" does not.

---

### 6. Recommendations for the app

1. **Don't show a percent.** Show a tier label plus a short bar or a row of dots. Netflix dropped its percent, precise numbers promise more than this quiz can deliver, and a low percent on the top result reads as failing.
2. **If a number is kept anyway** (for example, in a details view), the top club should land in the 70 to 95 range only when the student's answers really point to it. Don't hard-code a floor. Any number shown should come from the calibration below, not from the raw score out of a theoretical 100.
3. **Mapping raw scores to tiers:**
   - Run the scoring on a few thousand random or simulated answer sets (and on real responses once there are enough), and record each club's score distribution.
   - Compare the top score against that distribution, and also against the student's own best possible score given how many questions they answered.
   - Suggested tiers: **Great fit** at the 85th percentile or above, **Good fit** at 60 to 85, **Worth a look** below that but still in the top 6. A student who answered vaguely gets "Good fit" or lower, which is honest.
   - Break ties with a secondary rule (more matching interest tags, then fewer conflicting answers). If they are still tied, show them as a group: "These 3 clubs fit you equally well."
4. **Label wording:** "Great fit", "Good fit", "Worth a look". These are plain and clearly ordered, and they avoid probability words like "likely".
5. **Number of results:** your top 3 as cards, plus "Also worth a look" with 2 or 3 more in a lighter style, and a link to browse all clubs.
6. **Explanation format:** one line per club, built from the student's own answers and the club's tags: "Because you picked building things and working on a team." Only list reasons that actually added points, at most 2 or 3, and never use generic personality lines.
7. **The #1 card** should say what is always true: "Your strongest match", then the tier label, so the best club never looks like a failure.

**Recommendations that rest on weak or indirect evidence:**
- That students read match percents like school grades (an inference, not measured).
- Tier cut-offs at the 85th and 60th percentiles (a design choice to test with students).
- Top 3 plus 2 or 3 extra, instead of 5 (based on practice, not a direct study).
- That honest tie grouping builds trust (no direct study found).
- The 70 to 95 range for a displayed number (based on grading norms and inflation in other products).
- That labels work better than numbers for teens specifically (no teen-specific study found).

A quick check before launch: show 8 to 10 students both versions (percent against label, bar and reason) on their own answers and ask which feels more accurate.
