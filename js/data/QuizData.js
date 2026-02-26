
export const vocabList = [
    {
        word: "Peep",
        sentence: '"Once or twice she had <b>peeped</b> into the book her sister was reading, but it had no pictures."',
        options: [
            "A. To shout loudly at someone",
            "B. To look quickly and secretly",
            "C. To read a book carefully"
        ],
        answer: 1,
        image: "./peep.png"
    },
    {
        word: "Pleasure",
        sentence: '"She wondered whether the <b>pleasure</b> of making a daisy-chain would be worth the trouble of getting up."',
        options: [
            "A. A feeling of happiness or enjoyment",
            "B. A strong sense of pain",
            "C. A wish to sleep and rest"
        ],
        answer: 0,
        image: "./pleasure.png"
    },
    {
        word: "Remarkable",
        sentence: '"There was nothing so VERY <b>remarkable</b> in that; nor did Alice think it so very much out of the way."',
        options: [
            "A. Very ordinary and expected",
            "B. Worthy of attention; unusual or impressive",
            "C. Frightening and dangerous"
        ],
        answer: 1,
        image: "./remarkable.png"
    }
];

export const midBossQuizzes = [
    { q: "Why was Alice bored?", o: ["It was raining.", "The book had no pictures.", "She was hungry."], a: 1 },
    { q: "What animal ran by Alice?", o: ["A Black Cat", "A White Rabbit", "A Brown Dog"], a: 1 },
    { q: "What did the Rabbit take out of its pocket?", o: ["A Watch", "A Carrot", "A Map"], a: 0 }
];

export const finalBossQuiz = {
    passage:
        "Alice had always found the world perfectly ordinary \u2014 " +
        "until a White Rabbit rushed past her, muttering anxiously. " +
        "She tumbled into a hole where size and logic meant nothing. " +
        "Strange labels dared her to drink; tiny cakes made her grow tall. " +
        "In Wonderland, the rules she had always known no longer applied.",
    q: "Based on the text, what made the Rabbit's behavior truly remarkable to Alice?",
    o: [
        "A. It was wearing a waistcoat and had a watch.",
        "B. It was speaking in French.",
        "C. It was eating a jam tart while running.",
        "D. It had pink eyes that glowed in the dark."
    ],
    a: 0
};
