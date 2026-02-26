/**
 * AesopContent.js
 * Full game content for "Aesop's Fables" (Easy).
 * Three fables: The Fox and the Crow / The Tortoise and the Hare / The Boy Who Cried Wolf
 *
 * Structure mirrors StoryContent.js + StoryContent_Dynamic.js used by Alice.
 */

// ── WORD FORGE VOCAB (3 words) ────────────────────────────────────────────────
export const aesopVocab = [
    {
        word: "Flatter",
        sentence: '"The Fox began to <b>flatter</b> the Crow, praising her beauty to steal the cheese."',
        options: [
            "A. To speak harshly and criticise",
            "B. To praise someone in order to gain their favour",
            "C. To warn someone of great danger"
        ],
        answer: 1,
        image: "./flatter.png"
    },
    {
        word: "Persevere",
        sentence: '"The Tortoise chose to <b>persevere</b>, one steady step at a time, never stopping to rest."',
        options: [
            "A. To continue steadily despite difficulty",
            "B. To give up when things become hard",
            "C. To run as fast as possible"
        ],
        answer: 0,
        image: "./persevere.png"
    },
    {
        word: "Deceit",
        sentence: '"The boy laughed at his own <b>deceit</b>, never imagining the real danger that lay ahead."',
        options: [
            "A. An act of great courage",
            "B. The act of making someone believe something false",
            "C. A type of ancient folktale"
        ],
        answer: 1,
        image: "./deceit.png"
    }
];

// ── STORY PARAGRAPHS — slash-separated chunk format (Typewriter display) ──────
export const aesopStoryParagraphs = [
    "A Fox once saw / a Crow fly off / with a piece of cheese / in her beak. / 'That cheese shall be mine,' / thought the cunning Fox. / He perched below the tree / and called up to her: / 'Dear Crow, / what a beautiful bird you are! / Surely your voice / must be as lovely / as your feathers!' / The Crow, / pleased by such flattery, / opened her beak / to let out a great caw. / Down dropped the cheese / straight into the Fox's waiting jaws.",

    "The Hare laughed / when he saw the Tortoise / step up to the starting line. / 'A race against me?' / he cried. / 'This will be over / in a minute!' / He dashed ahead / so fast / that he was soon out of sight. / Far behind, / the Tortoise chose to persevere, / one plodding step / after another. / The Hare, / certain of victory, / lay down to rest / under a shady tree. / He slept long and deep. / When at last he woke, / he ran with all his might, / but the Tortoise / had already crossed / the finish line.",

    "Every day, / the boy was sent / to watch the sheep / on the hillside. / Bored and lonely, / he cried out / at the top of his voice: / 'Wolf! Wolf! / A wolf is attacking the flock!' / The villagers came running. / But they found no wolf — / only the boy, / laughing at his own deceit. / He played the same trick / the very next day. / Then one evening, / a real wolf appeared / and began to scatter the sheep. / The boy screamed / for help with all his might. / This time, / not one villager came. / The wolf had a fine feast that night."
];

// ── TOKEN-LEVEL PARAGRAPH DATA (Typewriter engine) ────────────────────────────
export const aesopStoryChapter = {
    story_id: "aesop_ch1",
    title: "Tales of Wisdom",
    paragraphs: [
        // ── Paragraph 1: The Fox and the Crow ───────────────────────────────
        {
            id: "p1",
            tokens: [
                { t: "A", b: 1 },
                { t: "Fox", b: 2 },
                { t: "once", b: 1 },
                { t: "saw", b: 1 },
                { t: "a", b: 1 },
                { t: "Crow", b: 2 },
                { t: "fly", b: 1 },
                { t: "off", b: 1 },
                { t: "with", b: 1 },
                { t: "a", b: 1 },
                { t: "piece", b: 2 },
                { t: "of", b: 1 },
                { t: "cheese", b: 3 },
                { t: "in", b: 1 },
                { t: "her", b: 1 },
                { t: "beak.", b: 4 },
                { t: "'That", b: 1 },
                { t: "cheese", b: 2 },
                { t: "shall", b: 1 },
                { t: "be", b: 1 },
                { t: "mine,'", b: 4 },
                { t: "thought", b: 1 },
                { t: "the", b: 1 },
                { t: "cunning", b: 3 },
                { t: "Fox.", b: 4 },
                { t: "He", b: 1 },
                { t: "perched", b: 2 },
                { t: "below", b: 1 },
                { t: "the", b: 1 },
                { t: "tree", b: 2 },
                { t: "and", b: 1 },
                { t: "called", b: 1 },
                { t: "up", b: 1 },
                { t: "to", b: 1 },
                { t: "her:", b: 4 },
                { t: "'Dear", b: 1 },
                { t: "Crow,", b: 4 },
                { t: "what", b: 1 },
                { t: "a", b: 1 },
                { t: "beautiful", b: 2 },
                { t: "bird", b: 2 },
                { t: "you", b: 1 },
                { t: "are!", b: 4 },
                { t: "Surely", b: 1 },
                { t: "your", b: 1 },
                { t: "voice", b: 2 },
                { t: "must", b: 1 },
                { t: "be", b: 1 },
                { t: "as", b: 1 },
                { t: "lovely", b: 2 },
                { t: "as", b: 1 },
                { t: "your", b: 1 },
                { t: "feathers!'", b: 4 },
                { t: "The", b: 1 },
                { t: "Crow,", b: 2 },
                { t: "pleased", b: 2 },
                { t: "by", b: 1 },
                { t: "such", b: 1 },
                { t: "flattery,", b: 4 },  // index 58 — vocab highlight: "Flatter"
                { t: "opened", b: 1 },
                { t: "her", b: 1 },
                { t: "beak", b: 2 },
                { t: "to", b: 1 },
                { t: "let", b: 1 },
                { t: "out", b: 1 },
                { t: "a", b: 1 },
                { t: "great", b: 1 },
                { t: "caw.", b: 4 },
                { t: "Down", b: 2 },
                { t: "dropped", b: 2 },
                { t: "the", b: 1 },
                { t: "cheese", b: 3 },
                { t: "straight", b: 1 },
                { t: "into", b: 1 },
                { t: "the", b: 1 },
                { t: "Fox's", b: 2 },
                { t: "waiting", b: 1 },
                { t: "jaws.", b: 4 }
            ],
            vocab_highlights: [
                {
                    word_id: "rune_flatter",
                    target_token_index: 58,  // "flattery,"
                    type: "bold_on_gaze"
                }
            ],
            core_phrase: {
                start_token_index: 16,  // 'That cheese shall be mine,'
                end_token_index: 20,
                importance: "high"
            }
        },

        // ── Paragraph 2: The Tortoise and the Hare ──────────────────────────
        {
            id: "p2",
            tokens: [
                { t: "The", b: 1 },
                { t: "Hare", b: 2 },
                { t: "laughed", b: 2 },
                { t: "when", b: 1 },
                { t: "he", b: 1 },
                { t: "saw", b: 1 },
                { t: "the", b: 1 },
                { t: "Tortoise", b: 2 },
                { t: "step", b: 1 },
                { t: "up", b: 1 },
                { t: "to", b: 1 },
                { t: "the", b: 1 },
                { t: "starting", b: 2 },
                { t: "line.", b: 4 },
                { t: "'A", b: 1 },
                { t: "race", b: 2 },
                { t: "against", b: 1 },
                { t: "me?'", b: 4 },
                { t: "he", b: 1 },
                { t: "cried.", b: 4 },
                { t: "'This", b: 1 },
                { t: "will", b: 1 },
                { t: "be", b: 1 },
                { t: "over", b: 1 },
                { t: "in", b: 1 },
                { t: "a", b: 1 },
                { t: "minute!'", b: 4 },
                { t: "He", b: 1 },
                { t: "dashed", b: 2 },
                { t: "ahead", b: 1 },
                { t: "so", b: 1 },
                { t: "fast", b: 3 },
                { t: "that", b: 1 },
                { t: "he", b: 1 },
                { t: "was", b: 1 },
                { t: "soon", b: 2 },
                { t: "out", b: 1 },
                { t: "of", b: 1 },
                { t: "sight.", b: 4 },
                { t: "Far", b: 1 },
                { t: "behind,", b: 4 },
                { t: "the", b: 1 },
                { t: "Tortoise", b: 2 },
                { t: "chose", b: 1 },
                { t: "to", b: 1 },
                { t: "persevere,", b: 4 },  // index 45 — vocab highlight: "Persevere"
                { t: "one", b: 1 },
                { t: "plodding", b: 2 },
                { t: "step", b: 1 },
                { t: "after", b: 1 },
                { t: "another.", b: 4 },
                { t: "The", b: 1 },
                { t: "Hare,", b: 2 },
                { t: "certain", b: 2 },
                { t: "of", b: 1 },
                { t: "victory,", b: 4 },
                { t: "lay", b: 1 },
                { t: "down", b: 1 },
                { t: "to", b: 1 },
                { t: "rest", b: 2 },
                { t: "under", b: 1 },
                { t: "a", b: 1 },
                { t: "shady", b: 1 },
                { t: "tree.", b: 4 },
                { t: "He", b: 1 },
                { t: "slept", b: 2 },
                { t: "long", b: 1 },
                { t: "and", b: 1 },
                { t: "deep.", b: 4 },
                { t: "When", b: 1 },
                { t: "at", b: 1 },
                { t: "last", b: 2 },
                { t: "he", b: 1 },
                { t: "woke,", b: 4 },
                { t: "he", b: 1 },
                { t: "ran", b: 2 },
                { t: "with", b: 1 },
                { t: "all", b: 1 },
                { t: "his", b: 1 },
                { t: "might,", b: 4 },
                { t: "but", b: 1 },
                { t: "the", b: 1 },
                { t: "Tortoise", b: 2 },
                { t: "had", b: 1 },
                { t: "already", b: 2 },
                { t: "crossed", b: 3 },
                { t: "the", b: 1 },
                { t: "finish", b: 2 },
                { t: "line.", b: 4 }
            ],
            vocab_highlights: [
                {
                    word_id: "rune_persevere",
                    target_token_index: 45,  // "persevere,"
                    type: "bold_on_gaze"
                }
            ],
            core_phrase: {
                start_token_index: 82,  // "had already crossed the finish line"
                end_token_index: 88,
                importance: "critical"
            }
        },

        // ── Paragraph 3: The Boy Who Cried Wolf ─────────────────────────────
        {
            id: "p3",
            tokens: [
                { t: "Every", b: 1 },
                { t: "day,", b: 4 },
                { t: "the", b: 1 },
                { t: "boy", b: 2 },
                { t: "was", b: 1 },
                { t: "sent", b: 1 },
                { t: "to", b: 1 },
                { t: "watch", b: 1 },
                { t: "the", b: 1 },
                { t: "sheep", b: 2 },
                { t: "on", b: 1 },
                { t: "the", b: 1 },
                { t: "hillside.", b: 4 },
                { t: "Bored", b: 2 },
                { t: "and", b: 1 },
                { t: "lonely,", b: 4 },
                { t: "he", b: 1 },
                { t: "cried", b: 2 },
                { t: "out", b: 1 },
                { t: "at", b: 1 },
                { t: "the", b: 1 },
                { t: "top", b: 1 },
                { t: "of", b: 1 },
                { t: "his", b: 1 },
                { t: "voice:", b: 4 },
                { t: "'Wolf!", b: 3 },
                { t: "Wolf!", b: 3 },
                { t: "A", b: 1 },
                { t: "wolf", b: 2 },
                { t: "is", b: 1 },
                { t: "attacking", b: 2 },
                { t: "the", b: 1 },
                { t: "flock!'", b: 4 },
                { t: "The", b: 1 },
                { t: "villagers", b: 2 },
                { t: "came", b: 1 },
                { t: "running.", b: 4 },
                { t: "But", b: 1 },
                { t: "they", b: 1 },
                { t: "found", b: 1 },
                { t: "no", b: 1 },
                { t: "wolf", b: 2 },
                { t: "—", b: 1 },
                { t: "only", b: 1 },
                { t: "the", b: 1 },
                { t: "boy,", b: 2 },
                { t: "laughing", b: 2 },
                { t: "at", b: 1 },
                { t: "his", b: 1 },
                { t: "own", b: 1 },
                { t: "deceit.", b: 4 },  // index 50 — vocab highlight: "Deceit"
                { t: "He", b: 1 },
                { t: "played", b: 1 },
                { t: "the", b: 1 },
                { t: "same", b: 1 },
                { t: "trick", b: 2 },
                { t: "the", b: 1 },
                { t: "very", b: 1 },
                { t: "next", b: 1 },
                { t: "day.", b: 4 },
                { t: "Then", b: 1 },
                { t: "one", b: 1 },
                { t: "evening,", b: 4 },
                { t: "a", b: 1 },
                { t: "real", b: 2 },
                { t: "wolf", b: 3 },
                { t: "appeared", b: 2 },
                { t: "and", b: 1 },
                { t: "began", b: 1 },
                { t: "to", b: 1 },
                { t: "scatter", b: 2 },
                { t: "the", b: 1 },
                { t: "sheep.", b: 4 },
                { t: "The", b: 1 },
                { t: "boy", b: 2 },
                { t: "screamed", b: 2 },
                { t: "for", b: 1 },
                { t: "help", b: 2 },
                { t: "with", b: 1 },
                { t: "all", b: 1 },
                { t: "his", b: 1 },
                { t: "might.", b: 4 },
                { t: "This", b: 1 },
                { t: "time,", b: 4 },
                { t: "not", b: 1 },
                { t: "one", b: 1 },
                { t: "villager", b: 2 },
                { t: "came.", b: 4 },
                { t: "The", b: 1 },
                { t: "wolf", b: 3 },
                { t: "had", b: 1 },
                { t: "a", b: 1 },
                { t: "fine", b: 1 },
                { t: "feast", b: 2 },
                { t: "that", b: 1 },
                { t: "night.", b: 4 }
            ],
            vocab_highlights: [
                {
                    word_id: "rune_deceit",
                    target_token_index: 50,  // "deceit."
                    type: "bold_on_gaze"
                }
            ],
            core_phrase: {
                start_token_index: 83,  // "not one villager came"
                end_token_index: 87,
                importance: "critical"
            }
        }
    ]
};

// ── MID-BOSS QUIZZES (one per paragraph) ─────────────────────────────────────
export const aesopMidBossQuizzes = [
    {
        q: "Why did the Crow drop the cheese?",
        o: [
            "She was frightened by the Fox's sudden appearance.",
            "She opened her beak to sing after the Fox flattered her.",
            "She dropped it by accident while trying to fly away."
        ],
        a: 1
    },
    {
        q: "Why did the Tortoise win the race against the Hare?",
        o: [
            "The Hare tripped and injured himself.",
            "The Tortoise was secretly faster than it appeared.",
            "The Hare fell asleep, too confident of victory."
        ],
        a: 2
    },
    {
        q: "Why did no one help the boy when the real wolf finally came?",
        o: [
            "The villagers were too far away to hear his cries.",
            "He had tricked them so many times before that no one believed him.",
            "The villagers thought the wolf was not dangerous."
        ],
        a: 1
    }
];

// ── FINAL BOSS QUIZ ───────────────────────────────────────────────────────────
export const aesopFinalBossQuiz = {
    passage:
        "A Fox tricked a Crow into dropping her cheese with empty flattery. " +
        "A Tortoise beat a confident Hare by choosing to persevere, one step at a time. " +
        "A boy who cried wolf for fun found that deceit has real consequences — " +
        "when the wolf truly came, not one villager believed him.",
    q: "What is the central moral lesson that connects all three of Aesop's Fables?",
    o: [
        "A. Power and strength always determine who wins in the end.",
        "B. Foolish choices and dishonesty lead to real and lasting consequences.",
        "C. Animals are naturally wiser than human beings in every situation.",
        "D. Speed and cleverness are more important than honesty."
    ],
    a: 1
};
