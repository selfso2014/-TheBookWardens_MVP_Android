
export const vocabList = [
    {
        word: "Luminous",
        sentence: '"The <b>luminous</b> mushroom lit up the dark cave."',
        options: [
            "A. Very heavy and dark",
            "B. Full of light / Shining",
            "C. Related to the moon"
        ],
        answer: 1,
        image: "./rune_luminous.png"
    },
    {
        word: "Peculiar",
        sentence: '"Alice felt a very <b>peculiar</b> change in her size."',
        options: [
            "A. Strange or odd",
            "B. Common and boring",
            "C. Sudden and fast"
        ],
        answer: 0,
        image: "./rune_peculiar.png"
    },
    {
        word: "Vanish",
        sentence: '"The cat began to <b>vanish</b> slowly, starting with its tail."',
        options: [
            "A. To appear suddenly",
            "B. To disappear completely",
            "C. To become brighter"
        ],
        answer: 1,
        image: "./rune_vanish.png"
    }
];

export const midBossQuizzes = [
    { q: "Why was Alice bored?", o: ["It was raining.", "The book had no pictures.", "She was hungry."], a: 1 },
    { q: "What animal ran by Alice?", o: ["A Black Cat", "A White Rabbit", "A Brown Dog"], a: 1 },
    { q: "What did the Rabbit take out of its pocket?", o: ["A Watch", "A Carrot", "A Map"], a: 0 }
];

export const finalBossQuiz = {
    q: "Based on the text, what made the Rabbit's behavior truly remarkable to Alice?",
    o: [
        "It was wearing a waistcoat and had a watch.",
        "It was speaking in French.",
        "It was eating a jam tart while running."
    ],
    a: 0
};
