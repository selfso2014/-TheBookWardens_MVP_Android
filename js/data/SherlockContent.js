/**
 * SherlockContent.js
 * Full game content for "The Adventures of Sherlock Holmes" (Hard).
 * Source: "A Scandal in Bohemia" — public domain, Arthur Conan Doyle.
 *
 * Structure mirrors AesopContent.js and StoryContent_Dynamic.js.
 */

// ── WORD FORGE VOCAB (3 words) ────────────────────────────────────────────────
export const sherlockVocab = [
    {
        word: "Astute",
        sentence: '"Holmes was <b>astute</b> enough to notice the mud on Watson\'s boot and name the exact street."',
        options: [
            "A. Clumsy and easily distracted",
            "B. Quick to notice and understand things with sharp accuracy",
            "C. Proud and stubborn in manner"
        ],
        answer: 1,
        image: "./astute.png"
    },
    {
        word: "Singular",
        sentence: '"It is a most <b>singular</b> case," said Holmes. "I have never encountered its like before."',
        options: [
            "A. Very ordinary and easy to explain",
            "B. Remarkably strange or unusual",
            "C. Already solved and finished"
        ],
        answer: 1,
        image: "./singular.png"
    },
    {
        word: "Discern",
        sentence: '"A man of your experience can surely <b>discern</b> the truth without my spelling it all out."',
        options: [
            "A. To ignore something completely",
            "B. To make a loud and public announcement",
            "C. To perceive or recognise something clearly"
        ],
        answer: 2,
        image: "./discern.png"
    }
];

// ── STORY PARAGRAPHS — slash-separated chunk format (Typewriter display) ──────
export const sherlockStoryParagraphs = [
    "To Sherlock Holmes / she is always THE woman. / I have seldom heard him / mention her / under any other name. / In his eyes / she eclipses / and predominates / the whole of her sex. / It was not / that he felt / any emotion akin to love / for Irene Adler. / All emotions, / and that one particularly, / were abhorrent / to his cold, / precise, / but admirably balanced mind.",

    "I had seen little of Holmes / lately. / My marriage had drifted us apart. / One night in late September, / my way led me / through Baker Street. / As I passed / the well-remembered door, / I was seized / with a keen desire / to see Holmes again. / Ascending the stairs, / I found him / lounging in his armchair, / a pipe between his fingers, / his eyes half-closed, / and a folded letter / lying open / upon the table beside him.",

    "He sat up at once / when he saw me, / with that singular clarity / that came upon him / at the start of a case. / 'Watson,' said he, / 'you have come / at exactly the right moment. / Tell me — / could you discern / anything unusual / in this letter?' / He tossed it to me. / The handwriting was bold / and the words were brief: / 'There is danger tonight. / Come at once.' / Signed by / no one at all."
];

// ── TOKEN-LEVEL PARAGRAPH DATA (Typewriter engine) ────────────────────────────
export const sherlockStoryChapter = {
    story_id: "sherlock_ch1",
    title: "A Scandal in Bohemia",
    paragraphs: [
        // ── Paragraph 1: The Woman ───────────────────────────────────────────
        {
            id: "p1",
            tokens: [
                { t: "To", b: 1 },
                { t: "Sherlock", b: 2 },
                { t: "Holmes", b: 3 },
                { t: "she", b: 1 },
                { t: "is", b: 1 },
                { t: "always", b: 2 },
                { t: "THE", b: 3 },
                { t: "woman.", b: 4 },
                { t: "I", b: 1 },
                { t: "have", b: 1 },
                { t: "seldom", b: 2 },
                { t: "heard", b: 1 },
                { t: "him", b: 1 },
                { t: "mention", b: 2 },
                { t: "her", b: 1 },
                { t: "under", b: 1 },
                { t: "any", b: 1 },
                { t: "other", b: 1 },
                { t: "name.", b: 4 },
                { t: "In", b: 1 },
                { t: "his", b: 1 },
                { t: "eyes", b: 2 },
                { t: "she", b: 1 },
                { t: "eclipses", b: 3 },
                { t: "and", b: 1 },
                { t: "predominates", b: 3 },
                { t: "the", b: 1 },
                { t: "whole", b: 1 },
                { t: "of", b: 1 },
                { t: "her", b: 1 },
                { t: "sex.", b: 4 },
                { t: "It", b: 1 },
                { t: "was", b: 1 },
                { t: "not", b: 1 },
                { t: "that", b: 1 },
                { t: "he", b: 1 },
                { t: "felt", b: 1 },
                { t: "any", b: 1 },
                { t: "emotion", b: 2 },
                { t: "akin", b: 2 },
                { t: "to", b: 1 },
                { t: "love", b: 3 },
                { t: "for", b: 1 },
                { t: "Irene", b: 2 },
                { t: "Adler.", b: 4 },
                { t: "All", b: 1 },
                { t: "emotions,", b: 2 },
                { t: "and", b: 1 },
                { t: "that", b: 1 },
                { t: "one", b: 1 },
                { t: "particularly,", b: 4 },
                { t: "were", b: 1 },
                { t: "abhorrent", b: 3 },
                { t: "to", b: 1 },
                { t: "his", b: 1 },
                { t: "cold,", b: 4 },
                { t: "precise,", b: 4 },
                { t: "but", b: 1 },
                { t: "admirably", b: 2 },
                { t: "balanced", b: 2 },
                { t: "mind.", b: 4 }
            ],
            vocab_highlights: [
                {
                    word_id: "rune_astute",
                    target_token_index: 23,  // "eclipses" — demonstrates Holmes's astute perception of Adler
                    type: "bold_on_gaze"
                }
            ],
            core_phrase: {
                start_token_index: 5,   // "always THE woman"
                end_token_index: 7,
                importance: "critical"
            }
        },

        // ── Paragraph 2: Watson Returns to Baker Street ──────────────────────
        {
            id: "p2",
            tokens: [
                { t: "I", b: 1 },
                { t: "had", b: 1 },
                { t: "seen", b: 1 },
                { t: "little", b: 2 },
                { t: "of", b: 1 },
                { t: "Holmes", b: 2 },
                { t: "lately.", b: 4 },
                { t: "My", b: 1 },
                { t: "marriage", b: 2 },
                { t: "had", b: 1 },
                { t: "drifted", b: 2 },
                { t: "us", b: 1 },
                { t: "apart.", b: 4 },
                { t: "One", b: 1 },
                { t: "night", b: 1 },
                { t: "in", b: 1 },
                { t: "late", b: 1 },
                { t: "September,", b: 4 },
                { t: "my", b: 1 },
                { t: "way", b: 1 },
                { t: "led", b: 1 },
                { t: "me", b: 1 },
                { t: "through", b: 1 },
                { t: "Baker", b: 2 },
                { t: "Street.", b: 4 },
                { t: "As", b: 1 },
                { t: "I", b: 1 },
                { t: "passed", b: 1 },
                { t: "the", b: 1 },
                { t: "well-remembered", b: 2 },
                { t: "door,", b: 4 },
                { t: "I", b: 1 },
                { t: "was", b: 1 },
                { t: "seized", b: 2 },
                { t: "with", b: 1 },
                { t: "a", b: 1 },
                { t: "keen", b: 2 },
                { t: "desire", b: 2 },
                { t: "to", b: 1 },
                { t: "see", b: 1 },
                { t: "Holmes", b: 2 },
                { t: "again.", b: 4 },
                { t: "Ascending", b: 2 },
                { t: "the", b: 1 },
                { t: "stairs,", b: 4 },
                { t: "I", b: 1 },
                { t: "found", b: 1 },
                { t: "him", b: 1 },
                { t: "lounging", b: 2 },
                { t: "in", b: 1 },
                { t: "his", b: 1 },
                { t: "armchair,", b: 4 },
                { t: "a", b: 1 },
                { t: "pipe", b: 2 },
                { t: "between", b: 1 },
                { t: "his", b: 1 },
                { t: "fingers,", b: 4 },
                { t: "his", b: 1 },
                { t: "eyes", b: 2 },
                { t: "half-closed,", b: 4 },
                { t: "and", b: 1 },
                { t: "a", b: 1 },
                { t: "folded", b: 2 },
                { t: "letter", b: 3 },
                { t: "lying", b: 1 },
                { t: "open", b: 1 },
                { t: "upon", b: 1 },
                { t: "the", b: 1 },
                { t: "table", b: 2 },
                { t: "beside", b: 1 },
                { t: "him.", b: 4 }
            ],
            vocab_highlights: [
                {
                    word_id: "rune_singular",
                    target_token_index: 63,  // "letter" — the singular item on the table that triggers the case
                    type: "bold_on_gaze"
                }
            ],
            core_phrase: {
                start_token_index: 42,  // "Ascending the stairs, I found him lounging in his armchair"
                end_token_index: 51,
                importance: "medium"
            }
        },

        // ── Paragraph 3: Holmes Issues a Challenge ───────────────────────────
        {
            id: "p3",
            tokens: [
                { t: "He", b: 1 },
                { t: "sat", b: 1 },
                { t: "up", b: 1 },
                { t: "at", b: 1 },
                { t: "once", b: 2 },
                { t: "when", b: 1 },
                { t: "he", b: 1 },
                { t: "saw", b: 1 },
                { t: "me,", b: 4 },
                { t: "with", b: 1 },
                { t: "that", b: 1 },
                { t: "singular", b: 3 },  // index 11 — vocab highlight: "Singular"
                { t: "clarity", b: 2 },
                { t: "that", b: 1 },
                { t: "came", b: 1 },
                { t: "upon", b: 1 },
                { t: "him", b: 1 },
                { t: "at", b: 1 },
                { t: "the", b: 1 },
                { t: "start", b: 2 },
                { t: "of", b: 1 },
                { t: "a", b: 1 },
                { t: "case.", b: 4 },
                { t: "'Watson,'", b: 2 },
                { t: "said", b: 1 },
                { t: "he,", b: 4 },
                { t: "'you", b: 1 },
                { t: "have", b: 1 },
                { t: "come", b: 1 },
                { t: "at", b: 1 },
                { t: "exactly", b: 2 },
                { t: "the", b: 1 },
                { t: "right", b: 2 },
                { t: "moment.", b: 4 },
                { t: "Tell", b: 1 },
                { t: "me", b: 1 },
                { t: "—", b: 1 },
                { t: "could", b: 1 },
                { t: "you", b: 1 },
                { t: "discern", b: 3 },  // index 39 — vocab highlight: "Discern"
                { t: "anything", b: 1 },
                { t: "unusual", b: 2 },
                { t: "in", b: 1 },
                { t: "this", b: 1 },
                { t: "letter?'", b: 4 },
                { t: "He", b: 1 },
                { t: "tossed", b: 2 },
                { t: "it", b: 1 },
                { t: "to", b: 1 },
                { t: "me.", b: 4 },
                { t: "The", b: 1 },
                { t: "handwriting", b: 2 },
                { t: "was", b: 1 },
                { t: "bold", b: 2 },
                { t: "and", b: 1 },
                { t: "the", b: 1 },
                { t: "words", b: 2 },
                { t: "were", b: 1 },
                { t: "brief:", b: 4 },
                { t: "'There", b: 1 },
                { t: "is", b: 1 },
                { t: "danger", b: 3 },
                { t: "tonight.", b: 4 },
                { t: "Come", b: 2 },
                { t: "at", b: 1 },
                { t: "once.'", b: 4 },
                { t: "Signed", b: 2 },
                { t: "by", b: 1 },
                { t: "no", b: 1 },
                { t: "one", b: 1 },
                { t: "at", b: 1 },
                { t: "all.", b: 4 }
            ],
            vocab_highlights: [
                {
                    word_id: "rune_discern",
                    target_token_index: 39,  // "discern"
                    type: "bold_on_gaze"
                }
            ],
            core_phrase: {
                start_token_index: 59,  // "There is danger tonight. Come at once."
                end_token_index: 65,
                importance: "critical"
            }
        }
    ]
};

// ── MID-BOSS QUIZZES (one per paragraph) ─────────────────────────────────────
export const sherlockMidBossQuizzes = [
    {
        q: "How does Watson describe the place Irene Adler holds in Holmes's mind?",
        o: [
            "She is the woman Holmes loves above all others.",
            "She eclipses the whole of her sex — she is simply 'the woman' to him.",
            "She is a dangerous criminal Holmes is determined to catch."
        ],
        a: 1
    },
    {
        q: "What did Watson notice when he arrived at Baker Street and found Holmes?",
        o: [
            "Holmes was pacing the room and dictating notes aloud.",
            "Holmes was lounging in his armchair with a pipe, and a letter lay open on the table.",
            "Holmes was already dressed and ready to go out on a case."
        ],
        a: 1
    },
    {
        q: "What was written in the mysterious letter Holmes showed to Watson?",
        o: [
            "'Meet me at midnight by the river. Tell no one.'",
            "'There is danger tonight. Come at once.' — signed by no one.",
            "'The game is afoot. Bring your revolver and say nothing to Watson.'"
        ],
        a: 1
    }
];

// ── FINAL BOSS QUIZ ───────────────────────────────────────────────────────────
export const sherlockFinalBossQuiz = {
    q: "Based on the opening, what quality most distinguishes Sherlock Holmes from an ordinary person?",
    o: [
        "His extraordinary physical strength and ability to fight criminals.",
        "His emotionless, precisely balanced mind that can discern what others completely overlook.",
        "His wide network of powerful friends in the British government."
    ],
    a: 1
};
