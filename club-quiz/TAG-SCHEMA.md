# Club attribute schema (v1 draft)

For each club output one JSON object:
{
 "name": exact club name,
 "interests": { "<interest key>": weight 1..3 },   // 3 = core purpose, 2 = clear secondary, 1 = minor mention. Only list what the description supports.
 "activities": { "<activity key>": weight 1..3 },  // what members actually DO at/through the club
 "commitment": "light" | "regular" | "heavy" | "unknown",
 "openness": "open" | "community" | "selective",
 "evidence": "short quote(s) from purpose/meetingInfo that justify the tags",
 "unknowns": "what the description does not say (e.g. purpose is a stub)",
 "confidence": "high" | "medium" | "low"
}

Interest keys (pick any that apply):
- coding: software, programming, apps, web, cybersecurity, cloud
- engineering: building physical things, robotics, rockets, aircraft/drones, computer hardware
- science: biology, physics, astronomy, chemistry, neuroscience, research, science communication
- math: math competitions, problem solving
- health: medicine, health careers, sports medicine, veterinary, mental health education
- business: business, entrepreneurship, investing, personal finance, careers
- debate_law_politics: debate, speech, law, mock trial, Model UN, geopolitics, history, current events
- writing_books: reading, books, poetry, creative writing
- visual_art: drawing, painting, animation, ceramics, crafts, knitting, design
- music: singing, instruments, music honor society
- dance: any dance (K-pop, folklórico, Bollywood, Just Dance)
- film_theatre: movies, filmmaking, acting, theatre
- culture_heritage: a specific culture/ethnic community or multicultural exchange
- language: learning or practicing a language
- faith: religious community
- service: volunteering, fundraising, community service hours
- environment: climate, sustainability, gardening, nature
- animals: animals, veterinary (added 2026-11-20)
- identity_support: safe space / advocacy for a group (LGBTQ+, disability inclusion, mental health stigma, girls in STEM/business)
- sports_fitness: playing a sport, martial arts, physical activity
- games: card games, board games, video/dance games, casual play
- food: cooking, food, tasting
- academics_honors: honor societies, academic recognition, GPA-based membership
- geography_world: geography, international affairs, global issues

Activity keys:
- compete: club exists to prepare for / attend competitions or tournaments
- build_make: hands-on making (code projects, rockets, art pieces, food, crafts)
- learn_discuss: presentations, lessons, discussions, guest speakers
- perform: performing for an audience (dance, music, theatre, speech)
- volunteer: service events, volunteer hours, fundraising
- hang_out_play: socializing, playing games, casual community, safe-space hangout

commitment (from meetingInfo + purpose): light = monthly or less, or casual drop-in; regular = weekly or biweekly lunch; heavy = after-school/evening practices, competition season, or multiple meetings a week. "unknown" if no info.
openness: open = anyone welcome; community = centered on a specific identity/heritage/faith group (note whether it says all are welcome in evidence); selective = honor society / GPA / application / tryout requirement.

Rules: never invent facts. If a description is a stub (e.g. "This club will go into."), tag only what the club NAME plainly implies, set confidence "low", and say so in unknowns.
