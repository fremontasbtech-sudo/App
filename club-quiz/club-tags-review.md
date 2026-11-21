# Club tag review (adversarial check of tags_merged.json)

14 of 76 clubs changed. Every other club was checked against its purpose and meetingInfo and left as is.

## Changes

- **4kidz**: Removed visual_art 1: "creative projects" never says art or crafts (kept build_make 1).
- **Art and animation club**: Added build_make 2: the name plainly says members make art and animation; activities were empty (purpose is a stub).
- **Basketball Club**: service 2 -> 3: coaching younger children through volunteering is the core activity (volunteer is already 3), alongside basketball.
- **Ceramics Club**: commitment heavy -> regular: two meetings a week, but the purpose is a relaxed drop-in ("sit back, relax, and create"), no practices or competitions; heavy would misdirect students looking for a casual art club.
- **Chinese club/NCHS**: Added academics_honors 1: name includes NCHS (National Chinese Honor Society) and purpose mentions it; matches French club/honors society.
- **Everyday Hardware Essentials Club**: Removed coding 1: purpose is only about physical computer hardware components; software is never mentioned.
- **Fremont High School Folklórico**: Added perform 1: a dance club with only learn_discuss under-describes it; "spread México's culture" through dance implies sharing it with others (weight kept low since shows are not stated).
- **Fremont Rocketry**: commitment light -> regular: meetings are monthly, but the club exists to compete in the American Rocketry Challenge, which requires designing, building, testing and launching rockets; light understates it.
- **Fremont Speech and Debate**: Added compete 2 and perform 1 -> 2: Speech and Debate is a competitive speaking team by name (meets after school too); public speaking is a core skill named in the purpose. compete kept at 2 because tournaments are not stated in the text.
- **French club/honors society**: learn_discuss 2 -> 3: it is the only activity and the core of the club (sharing language and culture through literature, cinema and conversation); consistent with Chinese club.
- **Girls in Business**: service 1 -> 2 and added volunteer 2: members organize business workshops and events for district students ages 10-16, which is outreach/service work, not just learning.
- **Konnect Dance Troupe (KDT)**: perform 1 -> 2: the name says "Dance Troupe", a performing group; K-Pop dance is the core.
- **Radical Researchers Club**: science 2 -> 3: research is the club's whole purpose (schema files research under science); confidence stays low because the field of research is not named.
- **Science Olympiad**: Added engineering 1: purpose says "STEM disciplines", and engineering is part of that umbrella.

## `community` field added (not counted as a change)

- BSU: `black`
- Chinese club/NCHS: `chinese`
- Chinese Song Club: `chinese`
- Fhs Christian Club: `christian`
- Filipino Youth Organization: `filipino`
- Fremont High School Folklórico: `latino`
- Fremont Zahraa: `south_asian`
- French club/honors society: `french`
- Indian Student Association (formerly Indian recognition society): `south_asian`
- Japanese Culture Club: `japanese`
- Jewish Student union: `jewish`
- Konnect Dance Troupe (KDT): `korean`
- LSU: `latino`
- Multicultural club: `multicultural`
- Muslim Community Association (MSA): `muslim`

Fremont GSA, Girls in Business and Girls Who Code keep openness `community` (identity groups) but get no `community` value, since none of the allowed values fits.

## Checked and deliberately left alone

- Fremont Zahraa: purpose is only "Bollywood dance club"; activities stay empty rather than guessing whether they perform.
- Fremont High Robotics: robotics teams usually compete, but the text never says so; no compete tag.
- Model United Nations: no compete tag; the text describes simulation and public speaking, not competitions.
- Geopolitics and History: purpose and meetingInfo are blank; name-only tags kept at low confidence.
- Culture clubs about learning a culture (Chinese, Japanese, French, Multicultural, KDT, Folklórico) stay `open`; clubs that represent a heritage or faith community (BSU, FYO, ISA, LSU, JSU, MSA, Christian) stay `community`. ISA and the Christian club say all students are welcome, which their evidence notes.
- Coding clubs are consistent: Developer, Hack Club and Ship It are build-first (build_make 3); Cloud Computing and Cybersecurity are lesson-first (learn_discuss 3). Developer keeps compete 1 for its annual hackathon.
- Honor societies are consistent: NHS and CSF both academics_honors 3, service 2, volunteer 3, selective; commitment follows their meeting frequency (monthly vs biweekly).
